import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SceneDocument } from "@foldthink/surface";
import { decodeBytes, encodeOperationEnvelope } from "@foldthink/synchronization/protocol";
import type {
  CommittedOperation,
  WorkspaceState,
} from "@foldthink/synchronization/protocol";
import type { LocalOperation } from "@foldthink/workspace";
import WebSocket from "ws";

type RecoveryEvidence = Readonly<{
  version: 1;
  createdAt: string;
  workspaceId: string;
  bootstrapId: string;
  sessionCookie: string;
  operationId: string;
  operationSequence: string;
  surfaceId: "board";
  surfaceRevision: number;
  strokeId: string;
  assetId: string;
  assetSha256: string;
  assetBytesBase64: string;
}>;

type RequestContext = Readonly<{
  baseUrl: URL;
  cookie?: string;
}>;

function fail(message: string): never {
  throw new Error(message);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function responseBody(response: Response): Promise<string> {
  const body = await response.text();
  return body.length > 2_000 ? `${body.slice(0, 2_000)}...` : body;
}

async function request(
  context: RequestContext,
  route: string,
  init: RequestInit = {},
  expectedStatus = 200,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (context.cookie) headers.set("cookie", context.cookie);
  if (init.method && init.method !== "GET" && init.method !== "HEAD") {
    headers.set("origin", context.baseUrl.origin);
  }
  const response = await fetch(new URL(route, context.baseUrl), { ...init, headers });
  if (response.status !== expectedStatus) {
    fail(`${init.method ?? "GET"} ${route} returned ${response.status}: ${await responseBody(response)}`);
  }
  return response;
}

async function requireReleaseIdentity(context: RequestContext): Promise<Readonly<{
  revision: string;
  schemaMigration: string;
}>> {
  const health = await request(context, "/health");
  const healthValue = await health.json() as { status?: string; revision?: string };
  if (healthValue.status !== "alive" || !healthValue.revision) {
    fail("The release health response has no exact revision.");
  }
  const ready = await request(context, "/ready");
  const readyValue = await ready.json() as {
    status?: string;
    revision?: string;
    schemaMigration?: string;
    requiredSchemaMigration?: string;
  };
  if (
    readyValue.status !== "ready" ||
    readyValue.revision !== healthValue.revision ||
    !readyValue.schemaMigration ||
    readyValue.schemaMigration !== readyValue.requiredSchemaMigration
  ) {
    fail("The release is alive but its required database schema is not ready.");
  }
  const expectedRevision = process.env.EXPECTED_REVISION?.trim();
  if (expectedRevision && readyValue.revision !== expectedRevision) {
    fail(`The service runs ${readyValue.revision}; the court expected ${expectedRevision}.`);
  }
  return Object.freeze({
    revision: readyValue.revision,
    schemaMigration: readyValue.schemaMigration,
  });
}

async function bootstrap(context: RequestContext, workspaceId: string, bootstrapId: string): Promise<string> {
  const response = await request(context, "/api/session/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, bootstrapId }),
  });
  const value = await response.json() as { workspaceId?: string; role?: string };
  if (value.workspaceId !== workspaceId || value.role !== "owner") {
    fail("Anonymous bootstrap did not create the requested owner workspace.");
  }
  const setCookies = "getSetCookie" in response.headers
    ? (response.headers as Headers & { getSetCookie(): string[] }).getSetCookie()
    : [];
  const cookie = (setCookies[0] ?? response.headers.get("set-cookie") ?? "").split(";", 1)[0];
  if (!cookie?.startsWith("foldthink_session=")) {
    fail("Anonymous bootstrap did not return the court session cookie.");
  }
  return cookie;
}

async function observeOperation(
  context: Required<RequestContext>,
  workspaceId: string,
  operationId: string,
  action?: () => Promise<void>,
): Promise<CommittedOperation> {
  const websocketUrl = new URL("/sync", context.baseUrl);
  websocketUrl.protocol = websocketUrl.protocol === "https:" ? "wss:" : "ws:";
  websocketUrl.searchParams.set("workspaceId", workspaceId);
  websocketUrl.searchParams.set("after", "0");
  const socket = new WebSocket(websocketUrl, {
    headers: { cookie: context.cookie },
    origin: context.baseUrl.origin,
  });
  const opened = new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
    socket.once("unexpected-response", (_request, response) => {
      reject(new Error(`The synchronization stream returned HTTP ${response.statusCode}.`));
    });
  });
  const observed = new Promise<CommittedOperation>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Operation ${operationId} did not cross the WebSocket stream.`)), 10_000);
    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as {
          type?: string;
          operation?: CommittedOperation;
        };
        if (message.type === "operation" && message.operation?.envelope.operationId === operationId) {
          clearTimeout(timeout);
          resolve(message.operation);
        }
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  });
  try {
    await opened;
    await action?.();
    return await observed;
  } finally {
    socket.close(1000, "Foldthink court completed");
  }
}

async function readAndAssertState(context: Required<RequestContext>, evidence: RecoveryEvidence): Promise<WorkspaceState> {
  const response = await request(context, `/api/workspaces/${evidence.workspaceId}/state`);
  const state = await response.json() as WorkspaceState;
  const board = state.surfaces.find((surface) => surface.surfaceId === evidence.surfaceId);
  if (!board || board.revision !== evidence.surfaceRevision || Number(state.cursor) < Number(evidence.operationSequence)) {
    fail("The recovered workspace state does not contain the committed surface revision.");
  }
  const scene = new SceneDocument(evidence.surfaceId, decodeBytes(board.state));
  const stroke = scene.snapshot().elements.find((element) => element.id === evidence.strokeId);
  if (stroke?.kind !== "ink") {
    fail("The recovered CRDT scene does not contain the court stroke.");
  }
  return state;
}

async function uploadAsset(
  context: Required<RequestContext>,
  workspaceId: string,
  bytes: Uint8Array,
): Promise<string> {
  const digest = sha256(bytes);
  const reserved = await request(context, `/api/workspaces/${workspaceId}/assets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mimeType: "text/plain", size: bytes.byteLength, sha256: digest }),
  }, 201);
  const reservation = await reserved.json() as { assetId?: string; uploadToken?: string };
  if (!reservation.assetId || !reservation.uploadToken) fail("Asset reservation is incomplete.");
  await request(
    context,
    `/api/workspaces/${workspaceId}/assets/${reservation.assetId}/content?upload=${encodeURIComponent(reservation.uploadToken)}`,
    { method: "PUT", headers: { "content-type": "text/plain" }, body: bytes },
  );
  const finalized = await request(
    context,
    `/api/workspaces/${workspaceId}/assets/${reservation.assetId}/finalize`,
    { method: "POST" },
  );
  const record = await finalized.json() as { state?: string; sha256?: string };
  if (record.state !== "ready" || record.sha256 !== digest) {
    fail("The asset registry did not verify the uploaded bytes.");
  }
  return reservation.assetId;
}

async function readAndAssertAsset(context: Required<RequestContext>, evidence: RecoveryEvidence): Promise<void> {
  const metadata = await request(
    context,
    `/api/workspaces/${evidence.workspaceId}/assets/${evidence.assetId}`,
  );
  const record = await metadata.json() as { state?: string; sha256?: string };
  if (record.state !== "ready" || record.sha256 !== evidence.assetSha256) {
    fail("The recovered asset registry record is not ready or has the wrong digest.");
  }
  const content = await request(
    context,
    `/api/workspaces/${evidence.workspaceId}/assets/${evidence.assetId}/content`,
  );
  const bytes = new Uint8Array(await content.arrayBuffer());
  if (
    sha256(bytes) !== evidence.assetSha256 ||
    Buffer.from(bytes).toString("base64") !== evidence.assetBytesBase64
  ) {
    fail("The recovered object bytes do not match their durable registry record.");
  }
}

async function seed(baseUrl: URL, evidencePath: string): Promise<RecoveryEvidence> {
  const release = await requireReleaseIdentity({ baseUrl });
  const workspaceId = randomUUID();
  const bootstrapId = randomBytes(48).toString("base64url");
  const cookie = await bootstrap({ baseUrl }, workspaceId, bootstrapId);
  const context = Object.freeze({ baseUrl, cookie });
  const operationId = randomUUID();
  const strokeId = randomUUID();
  const stroke = Object.freeze({
    id: strokeId,
    kind: "ink" as const,
    version: 1,
    points: Object.freeze([
      Object.freeze({ x: 48, y: 52, pressure: 0.35, time: 1 }),
      Object.freeze({ x: 180, y: 124, pressure: 0.8, time: 2 }),
    ]),
    style: Object.freeze({ color: "#171714", width: 4, minimumOpacity: 0.25, maximumOpacity: 1 }),
  });
  const board = new SceneDocument("board");
  const mutation = board.transact([{ action: "put", element: stroke }], operationId);
  const operation: LocalOperation = Object.freeze({
    protocolVersion: 1,
    operationId,
    workspaceId,
    intent: Object.freeze({ kind: "commitStroke", surfaceId: "board", stroke }),
    updates: Object.freeze([{ surfaceId: "board", payload: mutation.update }]),
  });
  let submitted: CommittedOperation | undefined;
  const streamed = await observeOperation(context, workspaceId, operationId, async () => {
    const response = await request(context, `/api/workspaces/${workspaceId}/operations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(encodeOperationEnvelope(operation)),
    });
    submitted = await response.json() as CommittedOperation;
  });
  if (
    !submitted ||
    submitted.sequence !== streamed.sequence ||
    submitted.receipt.syncState !== "committed" ||
    submitted.receipt.surfaces[0]?.revision !== 1
  ) {
    fail("HTTP acknowledgement and WebSocket delivery disagree about the durable operation.");
  }
  const assetBytes = new TextEncoder().encode(`Foldthink recovery court ${workspaceId}`);
  const assetId = await uploadAsset(context, workspaceId, assetBytes);
  const evidence: RecoveryEvidence = Object.freeze({
    version: 1,
    createdAt: new Date().toISOString(),
    workspaceId,
    bootstrapId,
    sessionCookie: cookie,
    operationId,
    operationSequence: submitted.sequence,
    surfaceId: "board",
    surfaceRevision: 1,
    strokeId,
    assetId,
    assetSha256: sha256(assetBytes),
    assetBytesBase64: Buffer.from(assetBytes).toString("base64"),
  });
  await readAndAssertState(context, evidence);
  await readAndAssertAsset(context, evidence);
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    status: "seeded",
    revision: release.revision,
    schemaMigration: release.schemaMigration,
    workspaceId,
    operationId,
    operationSequence: submitted.sequence,
    assetId,
  })}\n`);
  return evidence;
}

async function loadEvidence(evidencePath: string): Promise<RecoveryEvidence> {
  const value = JSON.parse(await readFile(evidencePath, "utf8")) as RecoveryEvidence;
  if (value.version !== 1 || !value.workspaceId || !value.sessionCookie || !value.operationId) {
    fail("The recovery evidence file is malformed.");
  }
  return value;
}

async function verify(baseUrl: URL, evidencePath: string): Promise<void> {
  const evidence = await loadEvidence(evidencePath);
  const release = await requireReleaseIdentity({ baseUrl });
  const context = Object.freeze({ baseUrl, cookie: evidence.sessionCookie });
  const streamed = await observeOperation(context, evidence.workspaceId, evidence.operationId);
  if (streamed.sequence !== evidence.operationSequence || streamed.receipt.syncState !== "committed") {
    fail("WebSocket history did not recover the exact committed operation.");
  }
  await readAndAssertState(context, evidence);
  await readAndAssertAsset(context, evidence);
  process.stdout.write(`${JSON.stringify({
    status: "verified",
    revision: release.revision,
    schemaMigration: release.schemaMigration,
    workspaceId: evidence.workspaceId,
    operationId: evidence.operationId,
    operationSequence: evidence.operationSequence,
    assetId: evidence.assetId,
  })}\n`);
}

async function removeWorkspace(baseUrl: URL, evidencePath: string): Promise<void> {
  const evidence = await loadEvidence(evidencePath);
  const context = Object.freeze({ baseUrl, cookie: evidence.sessionCookie });
  const deletion = await request(
    context,
    `/api/workspaces/${evidence.workspaceId}`,
    { method: "DELETE" },
  );
  const receipt = await deletion.json() as { workspaceId?: string; queuedAssets?: number };
  if (receipt.workspaceId !== evidence.workspaceId || receipt.queuedAssets !== 1) {
    fail("Workspace deletion did not queue the known asset exactly once.");
  }
  await request(context, "/api/session/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId: evidence.workspaceId, bootstrapId: evidence.bootstrapId }),
  }, 410);
  process.stdout.write(`${JSON.stringify({ status: "deleted", workspaceId: evidence.workspaceId })}\n`);
}

const command = process.argv[2] ?? "full";
const baseUrl = new URL(process.env.FOLDTHINK_BASE_URL ?? "http://localhost:18080");
const evidencePath = path.resolve(process.argv[3] ?? path.join(tmpdir(), `foldthink-recovery-${process.pid}.json`));

if (command === "seed") {
  await seed(baseUrl, evidencePath);
} else if (command === "verify") {
  await verify(baseUrl, evidencePath);
} else if (command === "delete") {
  await removeWorkspace(baseUrl, evidencePath);
} else if (command === "full") {
  try {
    await seed(baseUrl, evidencePath);
    await verify(baseUrl, evidencePath);
    await removeWorkspace(baseUrl, evidencePath);
  } finally {
    await rm(evidencePath, { force: true });
  }
} else {
  fail("Use workspace-recovery-probe.mts with seed, verify, delete, or full.");
}

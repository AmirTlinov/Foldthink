import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type {
  AnonymousBootstrapRequest,
  CreateJoinCapabilityRequest,
  DeleteWorkspaceResponse,
} from "./session-protocol.js";
import {
  roleAllows,
  type AnonymousSession,
  type AuthorizedSession,
  type RequiredAccess,
} from "./device-session.js";
import type {
  ConsumedJoinCapability,
  JoinCapability,
} from "./join-capability.js";
import type { SessionStore, StoredSession } from "./session-store.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const bootstrapPattern = /^[A-Za-z0-9_-]{48,256}$/u;
const tokenPattern = /^[A-Za-z0-9_-]{32,256}$/u;

export class IdentityError extends Error {
  override readonly name = "IdentityError";

  constructor(
    readonly code: "invalid" | "unauthorized" | "forbidden" | "workspace_conflict" | "workspace_deleted" | "expired",
    message: string,
  ) {
    super(message);
  }
}

function hash(value: string): Uint8Array {
  return createHash("sha256").update(value, "utf8").digest();
}

function requireWorkspaceId(workspaceId: string): void {
  if (!uuidPattern.test(workspaceId)) {
    throw new IdentityError("invalid", "workspaceId must be a UUID.");
  }
}

export class SessionAuthority {
  readonly #store: SessionStore;
  readonly #hmacKey: string;
  readonly #now: () => Date;

  constructor(store: SessionStore, hmacKey: string, now: () => Date = () => new Date()) {
    if (Buffer.byteLength(hmacKey, "utf8") < 32) {
      throw new TypeError("SESSION_HMAC_KEY must contain at least 32 bytes.");
    }
    this.#store = store;
    this.#hmacKey = hmacKey;
    this.#now = now;
  }

  async bootstrap(request: AnonymousBootstrapRequest): Promise<AnonymousSession> {
    requireWorkspaceId(request.workspaceId);
    if (!bootstrapPattern.test(request.bootstrapId)) {
      throw new IdentityError("invalid", "bootstrapId is malformed.");
    }
    const now = this.#now();
    const sessionSecret = createHmac("sha256", this.#hmacKey)
      .update(`foldthink-session:${request.bootstrapId}`, "utf8")
      .digest("base64url");
    let stored: StoredSession;
    try {
      stored = await this.#store.claimBootstrap({
        bootstrapHash: hash(request.bootstrapId),
        workspaceId: request.workspaceId,
        sessionId: randomUUID(),
        sessionSecretHash: hash(sessionSecret),
        sessionExpiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000),
        claimExpiresAt: new Date(now.getTime() + 10 * 60 * 1_000),
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === "workspace_conflict" || error.code === "workspace_deleted")
      ) {
        const deleted = error.code === "workspace_deleted";
        throw new IdentityError(
          deleted ? "workspace_deleted" : "workspace_conflict",
          deleted ? "This workspace was deleted." : "The workspace identifier is already claimed.",
        );
      }
      throw error;
    }
    return Object.freeze({
      ...stored,
      sessionSecret,
      expiresAt: stored.expiresAt.toISOString(),
    });
  }

  async authorize(
    sessionSecret: string | undefined,
    workspaceId: string,
    requiredAccess: RequiredAccess,
  ): Promise<AuthorizedSession> {
    const session = await this.resume(sessionSecret, workspaceId);
    if (!roleAllows(session.role, requiredAccess)) {
      throw new IdentityError("forbidden", "The device session cannot perform this action.");
    }
    return Object.freeze({
      sessionId: session.sessionId,
      workspaceId: session.workspaceId,
      role: session.role,
    });
  }

  async resume(
    sessionSecret: string | undefined,
    workspaceId: string,
  ): Promise<AnonymousSession> {
    requireWorkspaceId(workspaceId);
    if (!sessionSecret || !tokenPattern.test(sessionSecret)) {
      throw new IdentityError("unauthorized", "A valid device session is required.");
    }
    const session = await this.#store.findSession(hash(sessionSecret), workspaceId, this.#now());
    if (!session) {
      throw new IdentityError("unauthorized", "The device session is unavailable.");
    }
    return Object.freeze({
      ...session,
      sessionSecret,
      expiresAt: session.expiresAt.toISOString(),
    });
  }

  async createJoinCapability(
    actor: AuthorizedSession,
    request: CreateJoinCapabilityRequest,
  ): Promise<JoinCapability> {
    if (actor.role !== "owner") {
      throw new IdentityError("forbidden", "Only a workspace owner can link another device.");
    }
    if (request.role !== "editor" && request.role !== "viewer") {
      throw new IdentityError("invalid", "A linked device must be an editor or viewer.");
    }
    if (!Number.isInteger(request.expiresInSeconds) || request.expiresInSeconds < 60 || request.expiresInSeconds > 86_400) {
      throw new IdentityError("invalid", "A join capability must live between one minute and one day.");
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.#now().getTime() + request.expiresInSeconds * 1_000);
    await this.#store.createJoinCapability({
      workspaceId: actor.workspaceId,
      role: request.role,
      tokenHash: hash(token),
      expiresAt,
      createdBySessionId: actor.sessionId,
    });
    return Object.freeze({
      workspaceId: actor.workspaceId,
      role: request.role,
      token,
      expiresAt: expiresAt.toISOString(),
    });
  }

  async consumeJoinCapability(token: string): Promise<ConsumedJoinCapability> {
    if (!tokenPattern.test(token)) {
      throw new IdentityError("invalid", "The join capability is malformed.");
    }
    const now = this.#now();
    const sessionSecret = randomBytes(32).toString("base64url");
    const stored = await this.#store.consumeJoinCapability({
      tokenHash: hash(token),
      sessionId: randomUUID(),
      sessionSecretHash: hash(sessionSecret),
      sessionExpiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000),
      now,
    });
    if (!stored) {
      throw new IdentityError("expired", "The join capability is unavailable.");
    }
    return Object.freeze({
      workspaceId: stored.workspaceId,
      role: stored.role === "owner" ? "editor" : stored.role,
      sessionId: stored.sessionId,
      sessionSecret,
      expiresAt: stored.expiresAt.toISOString(),
    });
  }

  async deleteWorkspace(
    actor: AuthorizedSession,
    backupRetentionDays: number,
  ): Promise<DeleteWorkspaceResponse> {
    if (actor.role !== "owner") {
      throw new IdentityError("forbidden", "Only a workspace owner can delete the workspace.");
    }
    if (!Number.isInteger(backupRetentionDays) || backupRetentionDays < 1 || backupRetentionDays > 365) {
      throw new IdentityError("invalid", "Backup retention must be between one and 365 days.");
    }
    return this.#store.deleteWorkspace(actor, backupRetentionDays);
  }
}

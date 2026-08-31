import type { CommandIntent, LocalOperation } from "@foldthink/workspace";

export type EncodedSurfaceUpdate = Readonly<{
  surfaceId: string;
  payload: string;
}>;

export type OperationEnvelope = Readonly<{
  protocolVersion: 1;
  operationId: string;
  workspaceId: string;
  intent: CommandIntent;
  updates: readonly EncodedSurfaceUpdate[];
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const idPattern = /^[A-Za-z0-9._:-]{1,160}$/u;

function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBytes(encoded: string, maximumBytes = 2_000_000): Uint8Array {
  if (encoded.length > Math.ceil(maximumBytes * 4 / 3) + 4) {
    throw new ProtocolError("payload_too_large", "A surface update exceeds the byte limit.");
  }
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    throw new ProtocolError("invalid_envelope", "A surface update is not valid base64.");
  }
  if (binary.length === 0 || binary.length > maximumBytes) {
    throw new ProtocolError("payload_too_large", "A surface update is empty or exceeds the byte limit.");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export class ProtocolError extends Error {
  override readonly name = "ProtocolError";

  constructor(
    readonly code: "unsupported_protocol" | "invalid_envelope" | "payload_too_large",
    message: string,
  ) {
    super(message);
  }
}

export function encodeOperationEnvelope(operation: LocalOperation): OperationEnvelope {
  return Object.freeze({
    protocolVersion: 1,
    operationId: operation.operationId,
    workspaceId: operation.workspaceId,
    intent: structuredClone(operation.intent),
    updates: Object.freeze(operation.updates.map((update) => Object.freeze({
      surfaceId: update.surfaceId,
      payload: encodeBytes(update.payload),
    }))),
  });
}

export function decodeOperationEnvelope(input: unknown): LocalOperation {
  if (!input || typeof input !== "object") {
    throw new ProtocolError("invalid_envelope", "The operation envelope must be an object.");
  }
  const candidate = input as Partial<OperationEnvelope>;
  if (candidate.protocolVersion !== 1) {
    throw new ProtocolError("unsupported_protocol", "Foldthink supports protocol version 1.");
  }
  if (
    typeof candidate.operationId !== "string" ||
    !uuidPattern.test(candidate.operationId) ||
    typeof candidate.workspaceId !== "string" ||
    !uuidPattern.test(candidate.workspaceId)
  ) {
    throw new ProtocolError("invalid_envelope", "Operation and workspace IDs must be UUIDs.");
  }
  if (!candidate.intent || typeof candidate.intent !== "object" || !("kind" in candidate.intent)) {
    throw new ProtocolError("invalid_envelope", "The operation needs a typed intent.");
  }
  const intent = candidate.intent as CommandIntent;
  if (
    (intent.kind !== "commitStroke" && intent.kind !== "patchSurface") ||
    typeof intent.surfaceId !== "string" ||
    !idPattern.test(intent.surfaceId)
  ) {
    throw new ProtocolError("invalid_envelope", "The operation intent is unsupported.");
  }
  if (intent.kind === "commitStroke") {
    if (!intent.stroke || typeof intent.stroke !== "object" || intent.stroke.kind !== "ink") {
      throw new ProtocolError("invalid_envelope", "A commitStroke intent needs one ink stroke.");
    }
  } else {
    if (!Array.isArray(intent.changes) || intent.changes.length === 0 || intent.changes.length > 64) {
      throw new ProtocolError("invalid_envelope", "A patchSurface intent needs between one and 64 changes.");
    }
    for (const change of intent.changes) {
      if (!change || typeof change !== "object") {
        throw new ProtocolError("invalid_envelope", "A surface change is malformed.");
      }
      if (change.action === "put") {
        if (!change.element || typeof change.element !== "object" || typeof change.element.id !== "string") {
          throw new ProtocolError("invalid_envelope", "A put change needs an element.");
        }
      } else if (change.action === "delete") {
        if (typeof change.elementId !== "string" || !idPattern.test(change.elementId)) {
          throw new ProtocolError("invalid_envelope", "A delete change needs an element ID.");
        }
      } else {
        throw new ProtocolError("invalid_envelope", "A surface change action is unsupported.");
      }
    }
  }
  if (!Array.isArray(candidate.updates) || candidate.updates.length === 0 || candidate.updates.length > 16) {
    throw new ProtocolError("invalid_envelope", "An operation needs between one and 16 surface updates.");
  }
  let totalBytes = 0;
  const updates = candidate.updates.map((update) => {
    if (
      !update ||
      typeof update !== "object" ||
      typeof update.surfaceId !== "string" ||
      !idPattern.test(update.surfaceId) ||
      typeof update.payload !== "string"
    ) {
      throw new ProtocolError("invalid_envelope", "A surface update is malformed.");
    }
    const payload = decodeBytes(update.payload);
    totalBytes += payload.byteLength;
    if (totalBytes > 2_000_000) {
      throw new ProtocolError("payload_too_large", "The operation exceeds the byte limit.");
    }
    return Object.freeze({ surfaceId: update.surfaceId, payload });
  });
  return Object.freeze({
    protocolVersion: 1,
    operationId: candidate.operationId,
    workspaceId: candidate.workspaceId,
    intent: structuredClone(intent),
    updates: Object.freeze(updates),
  });
}

export function encodeStateBytes(bytes: Uint8Array): string {
  return encodeBytes(bytes);
}

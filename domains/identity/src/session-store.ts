import type { AuthorizedSession, SessionRole } from "./device-session.js";
import type { DeleteWorkspaceResponse } from "./session-protocol.js";

export type BootstrapClaim = Readonly<{
  bootstrapHash: Uint8Array;
  workspaceId: string;
  sessionId: string;
  sessionSecretHash: Uint8Array;
  sessionExpiresAt: Date;
  claimExpiresAt: Date;
}>;

export type StoredSession = AuthorizedSession & Readonly<{
  expiresAt: Date;
}>;

export type StoredJoinCapability = Readonly<{
  workspaceId: string;
  role: Exclude<SessionRole, "owner">;
  tokenHash: Uint8Array;
  expiresAt: Date;
  createdBySessionId: string;
}>;

export interface SessionStore {
  claimBootstrap(claim: BootstrapClaim): Promise<StoredSession>;
  findSession(secretHash: Uint8Array, workspaceId: string, now: Date): Promise<StoredSession | undefined>;
  createJoinCapability(capability: StoredJoinCapability): Promise<void>;
  consumeJoinCapability(input: Readonly<{
    tokenHash: Uint8Array;
    sessionId: string;
    sessionSecretHash: Uint8Array;
    sessionExpiresAt: Date;
    now: Date;
  }>): Promise<StoredSession | undefined>;
  deleteWorkspace(
    actor: AuthorizedSession,
    backupRetentionDays: number,
  ): Promise<DeleteWorkspaceResponse>;
}

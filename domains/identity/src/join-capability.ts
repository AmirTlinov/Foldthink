import type { SessionRole } from "./device-session.js";

export type JoinCapability = Readonly<{
  workspaceId: string;
  role: Exclude<SessionRole, "owner">;
  token: string;
  expiresAt: string;
}>;

export type ConsumedJoinCapability = Readonly<{
  workspaceId: string;
  role: Exclude<SessionRole, "owner">;
  sessionId: string;
  sessionSecret: string;
  expiresAt: string;
}>;

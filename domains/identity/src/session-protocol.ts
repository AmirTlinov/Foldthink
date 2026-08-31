import type { SessionRole } from "./device-session.js";

export type AnonymousBootstrapRequest = Readonly<{
  workspaceId: string;
  bootstrapId: string;
}>;

export type AnonymousBootstrapResponse = Readonly<{
  workspaceId: string;
  role: SessionRole;
  expiresAt: string;
}>;

export type CreateJoinCapabilityRequest = Readonly<{
  role: Exclude<SessionRole, "owner">;
  expiresInSeconds: number;
}>;

export type JoinCapabilityResponse = Readonly<{
  workspaceId: string;
  role: Exclude<SessionRole, "owner">;
  token: string;
  expiresAt: string;
}>;

export type ConsumeJoinCapabilityRequest = Readonly<{
  token: string;
}>;

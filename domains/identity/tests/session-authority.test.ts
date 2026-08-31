import assert from "node:assert/strict";
import test from "node:test";
import type {
  BootstrapClaim,
  SessionStore,
  StoredJoinCapability,
  StoredSession,
} from "../src/session-store.js";
import type { AuthorizedSession } from "../src/device-session.js";
import { IdentityError, SessionAuthority } from "../src/public-server.js";

class MemorySessionStore implements SessionStore {
  readonly claims = new Map<string, StoredSession>();
  readonly secrets = new Map<string, StoredSession>();
  readonly joins = new Map<string, StoredJoinCapability>();
  readonly deleted = new Set<string>();

  async claimBootstrap(claim: BootstrapClaim): Promise<StoredSession> {
    if (this.deleted.has(claim.workspaceId)) {
      throw Object.assign(new Error("deleted"), { code: "workspace_deleted" });
    }
    const claimKey = Buffer.from(claim.bootstrapHash).toString("hex");
    const existing = this.claims.get(claimKey);
    if (existing) return existing;
    const session: StoredSession = {
      sessionId: claim.sessionId,
      workspaceId: claim.workspaceId,
      role: "owner",
      expiresAt: claim.sessionExpiresAt,
    };
    this.claims.set(claimKey, session);
    this.secrets.set(Buffer.from(claim.sessionSecretHash).toString("hex"), session);
    return session;
  }

  async findSession(secretHash: Uint8Array): Promise<StoredSession | undefined> {
    return this.secrets.get(Buffer.from(secretHash).toString("hex"));
  }

  async createJoinCapability(capability: StoredJoinCapability): Promise<void> {
    this.joins.set(Buffer.from(capability.tokenHash).toString("hex"), capability);
  }

  async consumeJoinCapability(input: Readonly<{
    tokenHash: Uint8Array;
    sessionId: string;
    sessionSecretHash: Uint8Array;
    sessionExpiresAt: Date;
    now: Date;
  }>): Promise<StoredSession | undefined> {
    const key = Buffer.from(input.tokenHash).toString("hex");
    const capability = this.joins.get(key);
    if (!capability || capability.expiresAt <= input.now) return undefined;
    this.joins.delete(key);
    const session: StoredSession = {
      sessionId: input.sessionId,
      workspaceId: capability.workspaceId,
      role: capability.role,
      expiresAt: input.sessionExpiresAt,
    };
    this.secrets.set(Buffer.from(input.sessionSecretHash).toString("hex"), session);
    return session;
  }

  async deleteWorkspace(
    actor: AuthorizedSession,
    backupRetentionDays: number,
  ): Promise<Readonly<{
    workspaceId: string;
    deletedAt: string;
    backupRetentionUntil: string;
    queuedAssets: number;
  }>> {
    this.deleted.add(actor.workspaceId);
    const deletedAt = new Date("2026-08-31T00:00:00.000Z");
    return Object.freeze({
      workspaceId: actor.workspaceId,
      deletedAt: deletedAt.toISOString(),
      backupRetentionUntil: new Date(deletedAt.getTime() + backupRetentionDays * 86_400_000).toISOString(),
      queuedAssets: 0,
    });
  }
}

const workspaceId = "018f355b-cdf6-7ca4-9ca8-64df7c7d2045";
const bootstrapId = "a".repeat(64);

test("bootstrap retries return one anonymous owner session", async () => {
  const store = new MemorySessionStore();
  const authority = new SessionAuthority(store, "test-secret-key-with-at-least-32-bytes");
  const first = await authority.bootstrap({ workspaceId, bootstrapId });
  const retry = await authority.bootstrap({ workspaceId, bootstrapId });
  assert.equal(retry.sessionId, first.sessionId);
  assert.equal(retry.sessionSecret, first.sessionSecret);
  assert.equal((await authority.authorize(first.sessionSecret, workspaceId, "owner")).role, "owner");
});

test("a join capability is consumed once and inherits its bounded role", async () => {
  const store = new MemorySessionStore();
  const authority = new SessionAuthority(store, "test-secret-key-with-at-least-32-bytes");
  const owner = await authority.bootstrap({ workspaceId, bootstrapId });
  const capability = await authority.createJoinCapability(owner, {
    role: "editor",
    expiresInSeconds: 600,
  });
  const linked = await authority.consumeJoinCapability(capability.token);
  assert.equal(linked.workspaceId, workspaceId);
  assert.equal(linked.role, "editor");
  await assert.rejects(
    authority.consumeJoinCapability(capability.token),
    (error: unknown) => error instanceof IdentityError && error.code === "expired",
  );
});

test("only the owner can delete active data and a tombstone prevents resurrection", async () => {
  const store = new MemorySessionStore();
  const authority = new SessionAuthority(store, "test-secret-key-with-at-least-32-bytes");
  const owner = await authority.bootstrap({ workspaceId, bootstrapId });
  const receipt = await authority.deleteWorkspace(owner, 30);
  assert.equal(receipt.workspaceId, workspaceId);
  assert.equal(receipt.backupRetentionUntil, "2026-09-30T00:00:00.000Z");
  await assert.rejects(
    authority.bootstrap({ workspaceId, bootstrapId: "b".repeat(64) }),
    (error: unknown) => error instanceof IdentityError && error.code === "workspace_deleted",
  );
  await assert.rejects(
    authority.deleteWorkspace({ ...owner, role: "editor" }, 30),
    (error: unknown) => error instanceof IdentityError && error.code === "forbidden",
  );
});

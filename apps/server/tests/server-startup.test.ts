import assert from "node:assert/strict";
import test from "node:test";
import { readServerConfig } from "../src/server-config.js";

test("the server refuses to start without its durable and cryptographic owners", () => {
  assert.throws(() => readServerConfig({}), /DATABASE_URL/u);
  assert.throws(
    () => readServerConfig({ DATABASE_URL: "postgresql://localhost/foldthink" }),
    /SESSION_HMAC_KEY/u,
  );
  assert.throws(
    () => readServerConfig({
      DATABASE_URL: "postgresql://localhost/foldthink",
      SESSION_HMAC_KEY: "a-session-key-that-is-longer-than-32-bytes",
    }),
    /ASSET_DIRECTORY/u,
  );
});

test("the server exposes one exact public origin and revision", () => {
  const config = readServerConfig({
    DATABASE_URL: "postgresql://localhost/foldthink",
    SESSION_HMAC_KEY: "a-session-key-that-is-longer-than-32-bytes",
    PUBLIC_ORIGIN: "https://foldthink.example",
    REVISION: "abc123",
    ASSET_DIRECTORY: "/var/lib/foldthink/assets",
  });
  assert.equal(config.publicOrigin, "https://foldthink.example");
  assert.equal(config.revision, "abc123");
  assert.equal(config.production, false);
  assert.equal(config.backupRetentionDays, 30);
  assert.equal(config.secureCookie, true);
  assert.deepEqual(config.assets, {
    kind: "filesystem",
    directory: "/var/lib/foldthink/assets",
  });
});

test("production refuses an artifact without compiled release identity", () => {
  assert.throws(() => readServerConfig({
    NODE_ENV: "production",
    REVISION: "abc123",
    DATABASE_URL: "postgresql://localhost/foldthink",
    SESSION_HMAC_KEY: "a-session-key-that-is-longer-than-32-bytes",
    ASSET_DIRECTORY: "/var/lib/foldthink/assets",
  }), /contain its source revision/u);
});

test("public deletion has one explicit bounded backup-retention consequence", () => {
  const config = readServerConfig({
    DATABASE_URL: "postgresql://localhost/foldthink",
    SESSION_HMAC_KEY: "a-session-key-that-is-longer-than-32-bytes",
    ASSET_DIRECTORY: "/var/lib/foldthink/assets",
    BACKUP_RETENTION_DAYS: "45",
  });
  assert.equal(config.backupRetentionDays, 45);
  assert.throws(() => readServerConfig({
    DATABASE_URL: "postgresql://localhost/foldthink",
    SESSION_HMAC_KEY: "a-session-key-that-is-longer-than-32-bytes",
    ASSET_DIRECTORY: "/var/lib/foldthink/assets",
    BACKUP_RETENTION_DAYS: "0",
  }), /BACKUP_RETENTION_DAYS/u);
});

test("S3 storage is one complete explicit production boundary", () => {
  const config = readServerConfig({
    DATABASE_URL: "postgresql://localhost/foldthink",
    SESSION_HMAC_KEY: "a-session-key-that-is-longer-than-32-bytes",
    ASSET_BACKEND: "s3",
    ASSET_S3_BUCKET: "foldthink-assets",
    ASSET_S3_REGION: "auto",
    ASSET_S3_ENDPOINT: "https://objects.example",
    ASSET_S3_ACCESS_KEY_ID: "key",
    ASSET_S3_SECRET_ACCESS_KEY: "secret",
  });
  assert.equal(config.assets.kind, "s3");
  assert.equal(config.assets.endpoint, "https://objects.example");
});

test("the document compiler receives one explicit absolute cache owner", () => {
  const config = readServerConfig({
    DATABASE_URL: "postgresql://localhost/foldthink",
    SESSION_HMAC_KEY: "a-session-key-that-is-longer-than-32-bytes",
    ASSET_DIRECTORY: "/var/lib/foldthink/assets",
    LATEX_CACHE_DIRECTORY: "/opt/tectonic-cache/Tectonic",
  });
  assert.equal(config.latex.cacheDirectory, "/opt/tectonic-cache/Tectonic");
  assert.throws(() => readServerConfig({
    DATABASE_URL: "postgresql://localhost/foldthink",
    SESSION_HMAC_KEY: "a-session-key-that-is-longer-than-32-bytes",
    ASSET_DIRECTORY: "/var/lib/foldthink/assets",
    LATEX_CACHE_DIRECTORY: "relative/cache",
  }), /LATEX_CACHE_DIRECTORY/u);
});

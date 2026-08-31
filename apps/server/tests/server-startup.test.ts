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
  assert.equal(config.secureCookie, true);
  assert.deepEqual(config.assets, {
    kind: "filesystem",
    directory: "/var/lib/foldthink/assets",
  });
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

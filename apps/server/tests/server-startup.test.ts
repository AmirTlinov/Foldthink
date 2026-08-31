import assert from "node:assert/strict";
import test from "node:test";
import { readServerConfig } from "../src/server-config.js";

test("the server refuses to start without its durable and cryptographic owners", () => {
  assert.throws(() => readServerConfig({}), /DATABASE_URL/u);
  assert.throws(
    () => readServerConfig({ DATABASE_URL: "postgresql://localhost/foldthink" }),
    /SESSION_HMAC_KEY/u,
  );
});

test("the server exposes one exact public origin and revision", () => {
  const config = readServerConfig({
    DATABASE_URL: "postgresql://localhost/foldthink",
    SESSION_HMAC_KEY: "a-session-key-that-is-longer-than-32-bytes",
    PUBLIC_ORIGIN: "https://foldthink.example",
    REVISION: "abc123",
  });
  assert.equal(config.publicOrigin, "https://foldthink.example");
  assert.equal(config.revision, "abc123");
  assert.equal(config.secureCookie, true);
});

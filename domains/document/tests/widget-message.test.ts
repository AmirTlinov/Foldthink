import assert from "node:assert/strict";
import test from "node:test";
import { parseWidgetMessage } from "../src/widget-message.js";

test("the widget channel and protocol identify the one owning host", () => {
  const accepted = parseWidgetMessage({
    protocolVersion: 1,
    channel: "owned-channel",
    kind: "setState",
    state: { count: 2 },
  }, "owned-channel");
  assert.deepEqual(accepted, {
    protocolVersion: 1,
    channel: "owned-channel",
    kind: "setState",
    state: { count: 2 },
  });

  assert.equal(parseWidgetMessage({
    protocolVersion: 1,
    channel: "another-channel",
    kind: "setState",
    state: { count: 99 },
  }, "owned-channel"), undefined);
  assert.equal(parseWidgetMessage({
    protocolVersion: 2,
    channel: "owned-channel",
    kind: "ready",
  }, "owned-channel"), undefined);
});

test("widget diagnostics are bounded before they reach the host", () => {
  const message = parseWidgetMessage({
    protocolVersion: 1,
    channel: "proof",
    kind: "error",
    message: "x".repeat(4_000),
  }, "proof");
  assert.equal(message?.kind, "error");
  if (message?.kind === "error") assert.equal(message.message.length, 1_000);
});

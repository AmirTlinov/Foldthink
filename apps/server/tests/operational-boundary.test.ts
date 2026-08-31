import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import { admissionClientKey, RequestAdmission, requestClass } from "../src/request-admission.js";
import { ServiceObserver, routeTemplate } from "../src/service-observer.js";

test("request admission bounds total work, compile work, and per-client rate", () => {
  let now = 0;
  const admission = new RequestAdmission({
    capacity: 20,
    refillPerSecond: 1,
    maximumConcurrent: 2,
    maximumConcurrentCompiles: 1,
    now: () => now,
  });
  const compile = admission.acquire("device-a", "compile");
  assert.throws(() => admission.acquire("device-b", "compile"), /compilation capacity/u);
  const ordinary = admission.acquire("device-b", "ordinary");
  assert.throws(() => admission.acquire("device-c", "ordinary"), /bounded request capacity/u);
  ordinary.release();
  compile.release();
  assert.throws(() => admission.acquire("device-a", "ordinary"), /faster than/u);
  now = 1_000;
  admission.acquire("device-a", "ordinary").release();
});

test("route classification names responsibilities without retaining user identifiers", () => {
  assert.equal(routeTemplate("/api/workspaces/abc/operations"), "/api/workspaces/:workspaceId/operations");
  assert.equal(routeTemplate("/api/workspaces/abc/assets/secret/content"), "/api/workspaces/:workspaceId/assets/:assetId/content");
  assert.equal(routeTemplate("/unknown/private/value"), "unmatched");
  assert.equal(requestClass("POST", "/api/workspaces/abc/latex/compile"), "compile");
  assert.equal(requestClass("PUT", "/api/workspaces/abc/assets/file/content"), "upload");
});

test("anonymous sessions share a network ceiling without sharing a personal bucket", () => {
  const admission = new RequestAdmission({
    capacity: 20,
    refillPerSecond: 0,
    networkCapacity: 40,
    networkRefillPerSecond: 0,
  });
  const network = "203.0.113.7";
  admission.acquire(admissionClientKey(network, "first-secret"), "compile", network).release();
  admission.acquire(admissionClientKey(network, "second-secret"), "compile", network).release();
  assert.throws(
    () => admission.acquire(admissionClientKey(network, "third-secret"), "ordinary", network),
    /faster than/u,
  );
  assert.notEqual(
    admissionClientKey(network, "first-secret"),
    admissionClientKey(network, "second-secret"),
  );
  assert.doesNotMatch(admissionClientKey(network, "first-secret"), /first-secret/u);
});

test("service observation emits bounded structural facts and latency readouts", () => {
  let now = 10;
  const records: Readonly<Record<string, string | number>>[] = [];
  const observer = new ServiceObserver("abc123", (record) => records.push(record), () => now);
  const request = {
    method: "POST",
    headers: { "x-request-id": "request_123" },
  } as unknown as IncomingMessage;
  const observation = observer.begin(request, "/api/workspaces/private-id/operations");
  now = 22.5;
  observation.finish(200);
  assert.deepEqual(records[0], {
    event: "request.completed",
    requestId: "request_123",
    method: "POST",
    route: "/api/workspaces/:workspaceId/operations",
    status: 200,
    durationMilliseconds: 12.5,
    revision: "abc123",
  });
  assert.equal(JSON.stringify(records).includes("private-id"), false);
  assert.equal(observer.metrics().commitAcknowledgementMilliseconds.p95, 12.5);
});

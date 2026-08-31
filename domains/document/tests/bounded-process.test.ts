import assert from "node:assert/strict";
import test from "node:test";
import { ProcessLimitError, runBoundedProcess } from "../src/bounded-process.js";

test("the process owner distinguishes a time limit from an output limit", async () => {
  await assert.rejects(
    runBoundedProcess({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 10_000)"],
      cwd: process.cwd(),
      timeoutMilliseconds: 25,
      maximumOutputBytes: 1_000,
    }),
    (error: unknown) => error instanceof ProcessLimitError && error.limit === "timeout",
  );

  await assert.rejects(
    runBoundedProcess({
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(4_000))"],
      cwd: process.cwd(),
      timeoutMilliseconds: 2_000,
      maximumOutputBytes: 100,
    }),
    (error: unknown) => error instanceof ProcessLimitError && error.limit === "output",
  );
});

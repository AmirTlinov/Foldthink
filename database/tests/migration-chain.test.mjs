import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const databaseDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("migrations form one named total order with one statement owner", async () => {
  const names = (await readdir(path.join(databaseDirectory, "migrations"))).sort();
  assert.deepEqual(names, [
    "202608310001_identity__create_anonymous_sessions.sql",
    "202608310002_synchronization__create_operation_journal.sql",
  ]);
  for (const name of names) {
    assert.match(name, /^\d{12}_[a-z-]+__[a-z0-9_]+\.sql$/u);
    assert.doesNotMatch(await readFile(path.join(databaseDirectory, "migrations", name), "utf8"), /DROP\s+(?:TABLE|COLUMN)/iu);
  }
});

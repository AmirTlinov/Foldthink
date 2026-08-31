import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const databaseDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.join(databaseDirectory, "migrations");

export async function applyMigrations(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new TypeError("DATABASE_URL is required to apply migrations.");
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const names = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const name of names) {
      const existing = await client.query(
        "SELECT 1 FROM schema_migrations WHERE name = $1",
        [name],
      );
      if (existing.rowCount === 1) continue;
      const sql = await readFile(path.join(migrationsDirectory, name), "utf8");
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock(1179401817)");
        const afterLock = await client.query(
          "SELECT 1 FROM schema_migrations WHERE name = $1",
          [name],
        );
        if (afterLock.rowCount !== 1) {
          await client.query(sql);
          await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await applyMigrations();
}

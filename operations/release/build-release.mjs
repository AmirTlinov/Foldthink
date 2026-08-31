import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(projectRoot, "dist/release");

function git(...arguments_) {
  return execFileSync("git", arguments_, { cwd: projectRoot, encoding: "utf8" }).trim();
}

function run(command, arguments_, environment = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: projectRoot,
    env: { ...process.env, ...environment },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const revision = process.env.FOLDTHINK_BUILD_REVISION?.trim() || git("rev-parse", "HEAD");
if (!/^[0-9a-f]{40,64}$/u.test(revision)) {
  throw new TypeError("FOLDTHINK_BUILD_REVISION must be an exact hexadecimal commit.");
}
if (process.env.FOLDTHINK_ALLOW_DIRTY_BUILD !== "1" && git("status", "--porcelain")) {
  throw new Error("An immutable Foldthink release can only be built from a clean checkout.");
}

const migrationNames = (await readdir(path.join(projectRoot, "database/migrations")))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const schemaMigration = migrationNames.at(-1);
if (!schemaMigration) throw new Error("A release needs at least one database migration.");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
run("pnpm", ["--filter", "@foldthink/web", "build"], { GITHUB_SHA: revision });
await cp(path.join(projectRoot, "apps/web/dist"), path.join(output, "web"), { recursive: true });
await cp(path.join(projectRoot, "database/migrations"), path.join(output, "migrations"), { recursive: true });

const define = {
  __FOLDTHINK_BUILD_REVISION__: JSON.stringify(revision),
  __FOLDTHINK_SCHEMA_MIGRATION__: JSON.stringify(schemaMigration),
};
const nodeEsmBanner = {
  js: "import { createRequire as __foldthinkCreateRequire } from 'node:module'; const require = __foldthinkCreateRequire(import.meta.url);",
};
await build({
  entryPoints: [path.join(projectRoot, "apps/server/src/main.ts")],
  outfile: path.join(output, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: false,
  minify: true,
  define,
  banner: nodeEsmBanner,
});
await build({
  entryPoints: [path.join(projectRoot, "database/apply-migrations.mjs")],
  outfile: path.join(output, "migrate.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: false,
  minify: true,
  banner: nodeEsmBanner,
});

const server = await readFile(path.join(output, "server.mjs"));
const migration = await readFile(path.join(output, "migrate.mjs"));
const manifest = Object.freeze({
  revision,
  schemaMigration,
  node: "24.14.1",
  caddy: "2.11.4",
  tectonic: "0.16.9",
  serverSha256: sha256(server),
  migrationRunnerSha256: sha256(migration),
});
await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Foldthink release ${revision} requires ${schemaMigration}.\n`);

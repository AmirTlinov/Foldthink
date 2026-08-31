import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import {
  exists,
  fromProjectRoot,
  listDirectories,
  listFiles,
  projectRoot,
} from "./repository-tree.mjs";

const require = createRequire(import.meta.url);
const dependencyRules = require("../dependency-cruiser.cjs");
const errors = [];

if (!Array.isArray(dependencyRules.forbidden) || dependencyRules.forbidden.length === 0) {
  errors.push("dependency-cruiser.cjs contains no ownership rules.");
}

const forbiddenDirectoryNames = new Set([
  "core",
  "common",
  "shared",
  "utils",
  "helpers",
  "models",
  "services",
]);

for (const root of ["apps", "domains"]) {
  for (const directory of await listDirectories(root)) {
    if (forbiddenDirectoryNames.has(path.basename(directory))) {
      errors.push(`Unowned holding directory: ${directory}`);
    }
  }
}

if (await exists("packages")) {
  errors.push("Top-level packages/ bypasses the domain ownership map.");
}

const sourceNamePattern = /^(?:public(?:-(?:browser|server|protocol))?|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.(?:ts|tsx|mts|cts)$/;
const testNamePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.test\.(?:ts|tsx|mts|cts)$/;
const productFiles = [
  ...(await listFiles("apps")),
  ...(await listFiles("domains")),
];
const sourceFiles = productFiles.filter((file) => /\/src\/.*\.(?:ts|tsx|mts|cts)$/.test(file));
const testFiles = [
  ...productFiles.filter((file) => /\/tests\/.*\.(?:ts|tsx|mts|cts)$/.test(file)),
  ...(await listFiles("tests")).filter((file) => /\.(?:ts|tsx|mts|cts)$/.test(file)),
];
const importPattern =
  /(?:\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?|\bimport\s*\(|\brequire\s*\()\s*["']([^"']+)["']/g;

if (sourceFiles.length > 0) {
  const rootMap = await readFile(fromProjectRoot("AGENTS.md"), "utf8");
  if (rootMap.includes("The application source is not implemented yet.")) {
    errors.push("Root AGENTS.md still reports that product source is absent.");
  }
}

for (const sourceFile of sourceFiles) {
  if (!sourceNamePattern.test(path.basename(sourceFile))) {
    errors.push(`Source filename does not reveal one responsibility: ${sourceFile}`);
  }
  await validatePublicImports(sourceFile);
}

for (const testFile of testFiles) {
  if (!testNamePattern.test(path.basename(testFile))) {
    errors.push(`Test filename must describe one proof and end in .test: ${testFile}`);
  }
  await validatePublicImports(testFile);
}

async function validatePublicImports(file) {
  const body = await readFile(fromProjectRoot(file), "utf8");

  for (const match of body.matchAll(importPattern)) {
    const specifier = match[1];

    if (specifier.startsWith(".")) {
      const resolvedImport = path.resolve(
        path.dirname(fromProjectRoot(file)),
        specifier,
      );
      const relativeImport = path
        .relative(projectRoot, resolvedImport)
        .split(path.sep)
        .join("/");
      const sourceOwner = file.match(/^(apps|domains)\/([^/]+)\//);
      const targetOwner = relativeImport.match(/^(apps|domains)\/([^/]+)\//);

      if (
        sourceOwner &&
        targetOwner &&
        (sourceOwner[1] !== targetOwner[1] || sourceOwner[2] !== targetOwner[2])
      ) {
        errors.push(
          `Cross-owner relative import bypasses package exports: ${file} -> ${specifier}`,
        );
      }
      continue;
    }

    if (specifier.startsWith("@foldthink/")) {
      const foldthinkImport = specifier.match(/^@foldthink\/([^/]+)(?:\/(.+))?$/);
      const entrypoint = foldthinkImport?.[2];
      if (
        !foldthinkImport ||
        (entrypoint && !["browser", "server", "protocol"].includes(entrypoint))
      ) {
        errors.push(
          `Foldthink import bypasses a public entry point: ${file} -> ${specifier}`,
        );
      }
    }
  }
}

for (const ownerRoot of ["apps", "domains"]) {
  const entries = await readdir(fromProjectRoot(ownerRoot), { withFileTypes: true });

  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const relativeOwner = `${ownerRoot}/${entry.name}`;
    const ownerSource = sourceFiles.filter((file) => file.startsWith(`${relativeOwner}/src/`));
    const hasPackage = await exists(`${relativeOwner}/package.json`);

    if (ownerSource.length === 0 && hasPackage) {
      errors.push(`${relativeOwner}/package.json exists before executable source.`);
      continue;
    }

    if (ownerSource.length === 0) {
      continue;
    }

    for (const requiredPath of [
      `${relativeOwner}/package.json`,
      `${relativeOwner}/tsconfig.json`,
      `${relativeOwner}/tests`,
    ]) {
      if (!(await exists(requiredPath))) {
        errors.push(`Activated owner lacks ${requiredPath}.`);
      }
    }

    const ownerTests = testFiles.filter((file) => file.startsWith(`${relativeOwner}/tests/`));
    if (ownerTests.length === 0) {
      errors.push(`Activated owner has no adjacent executable proof: ${relativeOwner}`);
    }

    if (ownerRoot === "domains") {
      const contractBody = await readFile(
        fromProjectRoot(`${relativeOwner}/CONTRACT.md`),
        "utf8",
      );
      for (const ownerTest of ownerTests) {
        if (!contractBody.includes(path.basename(ownerTest))) {
          errors.push(`${relativeOwner}/CONTRACT.md does not link ${ownerTest}.`);
        }
      }
    }

    if (!hasPackage) {
      continue;
    }

    const packageBody = JSON.parse(
      await readFile(fromProjectRoot(`${relativeOwner}/package.json`), "utf8"),
    );
    for (const requiredScript of ["typecheck", "test"]) {
      if (!packageBody.scripts?.[requiredScript]) {
        errors.push(`${relativeOwner} has no ${requiredScript} proof command.`);
      }
    }

    if (ownerRoot !== "domains") {
      continue;
    }

    const expectedPackageName = `@foldthink/${entry.name}`;
    if (packageBody.name !== expectedPackageName) {
      errors.push(`${relativeOwner} must be named ${expectedPackageName}.`);
    }

    const packageExports = packageBody.exports;
    if (!packageExports || typeof packageExports !== "object" || Array.isArray(packageExports)) {
      errors.push(`${relativeOwner} must declare explicit package exports.`);
      continue;
    }

    const admittedExports = new Map([
      [".", "./src/public.ts"],
      ["./browser", "./src/public-browser.ts"],
      ["./server", "./src/public-server.ts"],
      ["./protocol", "./src/public-protocol.ts"],
    ]);

    for (const [exportName, exportTarget] of Object.entries(packageExports)) {
      if (!admittedExports.has(exportName) || admittedExports.get(exportName) !== exportTarget) {
        errors.push(`${relativeOwner} exposes an unowned entry: ${exportName} -> ${String(exportTarget)}`);
        continue;
      }

      if (!(await exists(`${relativeOwner}/${exportTarget.slice(2)}`))) {
        errors.push(`${relativeOwner} exports a missing file: ${exportTarget}`);
      }
    }
  }
}

if (await exists("database/migrations")) {
  const migrationFiles = (await listFiles("database/migrations")).filter((file) => file.endsWith(".sql"));
  const migrationNamePattern = /^\d{12}_[a-z][a-z0-9-]*__[a-z][a-z0-9_]*\.sql$/;

  for (const migrationFile of migrationFiles) {
    if (!migrationNamePattern.test(path.basename(migrationFile))) {
      errors.push(`Migration name does not state order, owner, and action: ${migrationFile}`);
    }
  }
}

if (errors.length === 0) {
  const cruiseInputs =
    sourceFiles.length > 0 ? [...sourceFiles, ...testFiles] : ["scripts"];
  const cruise = spawnSync(
    "pnpm",
    [
      "exec",
      "depcruise",
      "--config",
      "dependency-cruiser.cjs",
      "--output-type",
      "err",
      ...cruiseInputs,
    ],
    { cwd: projectRoot, encoding: "utf8" },
  );

  if (cruise.status !== 0) {
    errors.push(cruise.stdout || cruise.stderr || "dependency-cruiser failed.");
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(
  sourceFiles.length === 0
    ? `Ownership boundaries verified: ${dependencyRules.forbidden.length} rules; product source not activated.`
    : `Ownership boundaries verified across ${sourceFiles.length} source files.`,
);

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  exists,
  fromProjectRoot,
  listFiles,
  projectRoot,
} from "./repository-tree.mjs";

const errors = [];
const requiredPaths = [
  "AGENTS.md",
  "README.md",
  "PHILOSOPHY.md",
  "ARCHITECTURE.md",
  "CONTRACTS.md",
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "eslint.config.mjs",
  "dependency-cruiser.cjs",
  "apps/web/AGENTS.md",
  "apps/server/AGENTS.md",
  "database/AGENTS.md",
  "operations/AGENTS.md",
  "operations/CONTRACT.md",
  "tests/AGENTS.md",
  ".github/workflows/verify.yml",
];

for (const requiredPath of requiredPaths) {
  if (!(await exists(requiredPath))) {
    errors.push(`Missing mapped path: ${requiredPath}`);
  }
}

for (const removedPath of ["contracts", "packages/core", "migrations", "infra"]) {
  if (await exists(removedPath)) {
    errors.push(`Replaced path still exists: ${removedPath}`);
  }
}

const domainEntries = await readdir(fromProjectRoot("domains"), {
  withFileTypes: true,
});
const domainNames = domainEntries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (domainNames.length === 0) {
  errors.push("The repository has no ownership domains.");
}

const rootMap = await readFile(fromProjectRoot("AGENTS.md"), "utf8");
for (const domainName of domainNames) {
  const mapPath = `domains/${domainName}/AGENTS.md`;
  const contractPath = `domains/${domainName}/CONTRACT.md`;

  if (!(await exists(mapPath))) {
    errors.push(`Domain ${domainName} has no AGENTS.md map.`);
  }
  if (!(await exists(contractPath))) {
    errors.push(`Domain ${domainName} has no adjacent CONTRACT.md.`);
  }
  if (!rootMap.includes(`(${mapPath})`)) {
    errors.push(`Root AGENTS.md does not route to ${mapPath}.`);
  }
}

for (const mappedRoot of [
  "apps/web",
  "apps/server",
  ...domainNames.map((domainName) => `domains/${domainName}`),
  "database",
  "operations",
  "tests",
]) {
  const mapBody = await readFile(fromProjectRoot(`${mappedRoot}/AGENTS.md`), "utf8");
  const ownedFiles = (await listFiles(mappedRoot)).filter(
    (file) => path.basename(file) !== "AGENTS.md",
  );

  for (const ownedFile of ownedFiles) {
    if (!mapBody.includes(path.basename(ownedFile))) {
      errors.push(`${mappedRoot}/AGENTS.md does not map ${ownedFile}.`);
    }
  }
}

const markdownFiles = (await listFiles()).filter((file) => file.endsWith(".md"));
const relativeLinkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
const cyrillicPattern = /[\u0400-\u04ff]/;

for (const markdownFile of markdownFiles) {
  const body = await readFile(fromProjectRoot(markdownFile), "utf8");

  if (cyrillicPattern.test(body)) {
    errors.push(`Public Markdown must be English: ${markdownFile}`);
  }

  for (const match of body.matchAll(relativeLinkPattern)) {
    const destination = match[1].trim();
    if (/^(?:https?:|mailto:|#)/.test(destination)) {
      continue;
    }

    const pathWithoutFragment = destination.split("#", 1)[0];
    const absoluteDestination = path.resolve(
      path.dirname(fromProjectRoot(markdownFile)),
      decodeURIComponent(pathWithoutFragment),
    );

    if (!absoluteDestination.startsWith(`${projectRoot}${path.sep}`)) {
      errors.push(`Link leaves the repository in ${markdownFile}: ${destination}`);
      continue;
    }

    const relativeDestination = path.relative(projectRoot, absoluteDestination);
    if (!(await exists(relativeDestination))) {
      errors.push(`Broken link in ${markdownFile}: ${destination}`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Project map verified: ${domainNames.length} domains, ${markdownFiles.length} Markdown files.`);

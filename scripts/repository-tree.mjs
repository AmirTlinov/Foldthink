import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ignoredDirectoryNames = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
]);

export const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function fromProjectRoot(relativePath = ".") {
  return path.resolve(projectRoot, relativePath);
}

export function projectRelative(absolutePath) {
  return path.relative(projectRoot, absolutePath).split(path.sep).join("/");
}

export async function exists(relativePath) {
  try {
    await access(fromProjectRoot(relativePath));
    return true;
  } catch {
    return false;
  }
}

export async function listFiles(relativeRoot = ".") {
  const files = [];
  await visit(fromProjectRoot(relativeRoot), files, undefined);
  return files.map(projectRelative).sort();
}

export async function listDirectories(relativeRoot = ".") {
  const directories = [];
  await visit(fromProjectRoot(relativeRoot), undefined, directories);
  return directories.map(projectRelative).sort();
}

async function visit(currentPath, files, directories) {
  const entries = await readdir(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      directories?.push(entryPath);
      await visit(entryPath, files, directories);
    } else if (entry.isFile()) {
      files?.push(entryPath);
    }
  }
}

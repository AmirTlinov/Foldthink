import { readFile, readdir } from "node:fs/promises";
import { exists, fromProjectRoot, listFiles } from "./repository-tree.mjs";

const errors = [];
const domainEntries = await readdir(fromProjectRoot("domains"), {
  withFileTypes: true,
});
const domainNames = domainEntries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const expectedContracts = [
  ...domainNames.map((domainName) => `domains/${domainName}/CONTRACT.md`),
  "operations/CONTRACT.md",
].sort();
const actualContracts = (await listFiles())
  .filter((file) => file.endsWith("/CONTRACT.md"))
  .sort();

if (JSON.stringify(actualContracts) !== JSON.stringify(expectedContracts)) {
  errors.push(
    `Contract files differ from ownership domains. Expected ${expectedContracts.join(", ")}; found ${actualContracts.join(", ")}.`,
  );
}

if (await exists("contracts")) {
  errors.push("The replaced root contracts/ directory still exists.");
}

const indexBody = await readFile(fromProjectRoot("CONTRACTS.md"), "utf8");
const indexedContracts = [...indexBody.matchAll(/\]\(((?:domains\/[^)]+|operations)\/CONTRACT\.md)\)/g)]
  .map((match) => match[1])
  .sort();

if (JSON.stringify(indexedContracts) !== JSON.stringify(expectedContracts)) {
  errors.push(
    `CONTRACTS.md must index each adjacent contract exactly once. Found ${indexedContracts.join(", ")}.`,
  );
}

for (const contractPath of expectedContracts) {
  const body = await readFile(fromProjectRoot(contractPath), "utf8");
  const requiredPatterns = [
    [/^# /m, "title"],
    [/^> Domain:/m, "domain declaration"],
    [/^> Owners?:/m, "owner declaration"],
    [/^## Failure/m, "failure state"],
    [/^## Executable proof/m, "executable proof"],
  ];

  for (const [pattern, meaning] of requiredPatterns) {
    if (!pattern.test(body)) {
      errors.push(`${contractPath} has no ${meaning}.`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Contract index verified: ${expectedContracts.length} adjacent contracts.`);

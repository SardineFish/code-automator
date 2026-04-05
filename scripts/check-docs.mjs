import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredPaths = [
  "README.md",
  "AGENTS.md",
  "ARCHITECTURE.md",
  "extension/extensions.d.ts",
  "extension/example.js",
  "docs/PLAN.md",
  "docs/QUALITY_SCORE.md",
  "docs/design-docs/index.md",
  "docs/design-docs/core-beliefs.md",
  "docs/product-specs/index.md",
  "docs/product-specs/starter-scope.md",
  "docs/references/harness-engineering-notes.md"
];

const requiredAgentReferences = [
  "README.md",
  "ARCHITECTURE.md",
  "docs/PLAN.md",
  "docs/product-specs/index.md",
  "docs/design-docs/index.md",
  "docs/QUALITY_SCORE.md",
  "docs/references/harness-engineering-notes.md"
];

const failures = [];

for (const relativePath of requiredPaths) {
  const absolutePath = path.join(rootDir, relativePath);

  if (!statExists(absolutePath)) {
    failures.push(`Missing required repo knowledge file: ${relativePath}`);
  }
}

const rootMarkdownFiles = readdirSync(rootDir)
  .filter((entry) => entry.endsWith(".md"))
  .sort();

const allowedRootMarkdown = new Set(["AGENTS.md", "ARCHITECTURE.md", "README.md"]);

for (const fileName of rootMarkdownFiles) {
  if (!allowedRootMarkdown.has(fileName)) {
    failures.push(`Unexpected root markdown file: ${fileName}`);
  }
}

const agentsPath = path.join(rootDir, "AGENTS.md");

if (statExists(agentsPath)) {
  const agentsContents = readFileSync(agentsPath, "utf8");

  for (const reference of requiredAgentReferences) {
    if (!agentsContents.includes(reference)) {
      failures.push(`AGENTS.md is missing a reference to ${reference}`);
    }
  }
}

assertContains("docs/design-docs/index.md", ["core-beliefs.md"]);
assertContains("docs/product-specs/index.md", ["starter-scope.md"]);

if (failures.length > 0) {
  process.stderr.write("Documentation harness check failed:\n");

  for (const failure of failures) {
    process.stderr.write(`- ${failure}\n`);
  }

  process.exit(1);
}

process.stdout.write("Documentation harness check passed.\n");

function assertContains(relativePath, requiredSnippets) {
  const absolutePath = path.join(rootDir, relativePath);

  if (!statExists(absolutePath)) {
    return;
  }

  const contents = readFileSync(absolutePath, "utf8");

  for (const snippet of requiredSnippets) {
    if (!contents.includes(snippet)) {
      failures.push(`${relativePath} is missing ${snippet}`);
    }
  }
}

function statExists(absolutePath) {
  try {
    return statSync(absolutePath).isFile() || statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
}

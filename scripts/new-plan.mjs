import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const slug = process.argv[2];

if (!slug) {
  process.stderr.write("Usage: npm run plan:new -- <slug>\n");
  process.exit(1);
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const date = new Date().toISOString().slice(0, 10);
const safeSlug = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const relativePath = path.join("docs", "exec-plans", "active", `${date}-${safeSlug}.md`);
const absolutePath = path.join(rootDir, relativePath);

try {
  readFileSync(absolutePath, "utf8");
  process.stderr.write(`Plan already exists: ${relativePath}\n`);
  process.exit(1);
} catch {
  writeFileSync(
    absolutePath,
    `# ${safeSlug}\n\n## Objective\n\n-\n\n## Constraints\n\n-\n\n## Steps\n\n1. \n2. \n3. \n\n## Verification\n\n-\n\n## Notes\n\n-\n`
  );
}

process.stdout.write(`Created ${relativePath}\n`);


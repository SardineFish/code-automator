import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const disallowedLayers = ["types", "config", "repo", "runtime", "ui"];
const violations = [];

for (const layer of disallowedLayers) {
  for (const filePath of walk(path.join(rootDir, "src", layer))) {
    const contents = readFileSync(filePath, "utf8");

    if (contents.includes("/providers/")) {
      violations.push(path.relative(rootDir, filePath));
    }
  }
}

if (violations.length > 0) {
  process.stderr.write("Architecture check failed:\n");

  for (const violation of violations) {
    process.stderr.write(`- Non-service layer imports a provider: ${violation}\n`);
  }

  process.exit(1);
}

process.stdout.write("Architecture check passed.\n");

function* walk(dir) {
  try {
    for (const entry of readDir(dir)) {
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        yield* walk(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        yield entryPath;
      }
    }
  } catch {
    return;
  }
}

function readDir(dir) {
  return readdirSync(dir, { withFileTypes: true });
}

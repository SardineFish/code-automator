import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(rootDir, "src");
const supportedExtensions = new Set([".ts", ".tsx", ".js"]);
const allowedByLayer = {
  types: new Set(["types"]),
  config: new Set(["types", "config"]),
  repo: new Set(["types", "config", "repo"]),
  service: new Set(["types", "config", "repo", "service"]),
  runtime: new Set(["types", "config", "repo", "service", "runtime"]),
  ui: new Set(["types", "config", "repo", "service", "runtime", "ui"])
};

const failures = [];
const files = collectFiles(srcDir).filter((file) => supportedExtensions.has(path.extname(file)));

for (const filePath of files) {
  const relativePath = path.relative(rootDir, filePath);
  const lineCount = readFileSync(filePath, "utf8").split("\n").length;

  if (lineCount > 150) {
    failures.push(`${relativePath} is ${lineCount} lines. Split large files before they become hard to navigate.`);
  }

  const imports = collectImports(filePath);

  for (const specifier of imports) {
    if (!specifier.startsWith(".")) {
      continue;
    }

    const resolvedPath = resolveImport(filePath, specifier);
    const resolvedRelativePath = path.relative(rootDir, resolvedPath);
    validateImport(relativePath, resolvedRelativePath);
  }
}

if (failures.length > 0) {
  process.stderr.write("Architecture harness check failed:\n");

  for (const failure of failures) {
    process.stderr.write(`- ${failure}\n`);
  }

  process.exit(1);
}

process.stdout.write("Architecture harness check passed.\n");

function collectFiles(directory) {
  const entries = readdirSync(directory).sort();
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...collectFiles(fullPath));
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function collectImports(filePath) {
  const source = readFileSync(filePath, "utf8");
  const imports = [];
  const pattern = /(?:import\s+[^'"]*from\s+|import\s+)(['"])(.+?)\1/g;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    imports.push(match[2]);
  }

  return imports;
}

function resolveImport(fromFile, specifier) {
  const candidate = path.resolve(path.dirname(fromFile), specifier);

  if (path.extname(candidate)) {
    return candidate;
  }

  for (const extension of supportedExtensions) {
    const withExtension = `${candidate}${extension}`;

    if (statExists(withExtension)) {
      return withExtension;
    }
  }

  return `${candidate}.ts`;
}

function validateImport(sourceRelativePath, targetRelativePath) {
  const sourceParts = sourceRelativePath.split(path.sep);
  const targetParts = targetRelativePath.split(path.sep);

  if (sourceParts[0] === "src" && sourceParts[1] === "app") {
    return;
  }

  if (sourceParts[0] === "src" && sourceParts[1] === "providers") {
    if (targetParts[0] === "src" && targetParts[1] !== "providers") {
      failures.push(`${sourceRelativePath} should not depend on ${targetRelativePath}. Keep providers isolated.`);
    }

    return;
  }

  if (!(sourceParts[0] === "src" && sourceParts[1] === "domains")) {
    return;
  }

  const sourceDomain = sourceParts[2];
  const sourceLayer = sourceParts[3];

  if (targetParts[0] === "src" && targetParts[1] === "providers") {
    if (sourceLayer !== "service") {
      failures.push(`${sourceRelativePath} imports ${targetRelativePath}. Only the service layer may depend on providers.`);
    }

    return;
  }

  if (targetParts[0] === "src" && targetParts[1] === "app") {
    failures.push(`${sourceRelativePath} imports ${targetRelativePath}. Domain code must not depend on app wiring.`);
    return;
  }

  if (!(targetParts[0] === "src" && targetParts[1] === "domains")) {
    return;
  }

  const targetDomain = targetParts[2];
  const targetLayer = targetParts[3];

  if (sourceDomain !== targetDomain) {
    failures.push(`${sourceRelativePath} imports ${targetRelativePath}. Domains should not depend on each other directly.`);
    return;
  }

  const allowedLayers = allowedByLayer[sourceLayer];

  if (!allowedLayers || !allowedLayers.has(targetLayer)) {
    failures.push(`${sourceRelativePath} imports ${targetRelativePath}. ${sourceLayer} cannot depend on ${targetLayer}.`);
  }
}

function statExists(absolutePath) {
  try {
    return statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}

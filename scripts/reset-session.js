#!/usr/bin/env node

import { rm, unlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { getCodexReuseStatePath } from "./codex-reuse.js";

export async function resetSession(
  workspacePath = process.argv[2] ?? process.cwd(),
  dependencies = {}
) {
  const rmPath = dependencies.rm ?? rm;
  const unlinkFile = dependencies.unlink ?? unlink;
  const chdir = dependencies.chdir ?? process.chdir.bind(process);
  const cwd = dependencies.cwd ?? process.cwd();
  const resolvedWorkspacePath = path.resolve(workspacePath);

  try {
    await unlinkFile(getCodexReuseStatePath(resolvedWorkspacePath));
  } catch {
    // Ignore missing metadata so reset stays idempotent.
  }

  if (path.resolve(cwd) === resolvedWorkspacePath) {
    chdir(path.dirname(resolvedWorkspacePath));
  }

  await rmPath(resolvedWorkspacePath, { recursive: true, force: true });
}

async function main() {
  try {
    await resetSession();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Unknown reset-session error."}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

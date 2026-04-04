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
  const stderr = dependencies.stderr ?? process.stderr;
  const resolvedWorkspacePath = path.resolve(workspacePath);
  const stateFilePath = getCodexReuseStatePath(resolvedWorkspacePath);
  const resolvedCwd = path.resolve(cwd);

  log(stderr, `reset-session: starting workspace=${resolvedWorkspacePath} cwd=${resolvedCwd}`);

  try {
    await unlinkFile(stateFilePath);
    log(stderr, `reset-session: removed metadata ${stateFilePath}`);
  } catch (error) {
    log(
      stderr,
      `reset-session: metadata cleanup skipped path=${stateFilePath} reason=${formatError(error)}`
    );
  }

  if (resolvedCwd === resolvedWorkspacePath) {
    const nextPath = path.dirname(resolvedWorkspacePath);
    log(stderr, `reset-session: moving cwd from ${resolvedWorkspacePath} to ${nextPath}`);
    chdir(nextPath);
  } else {
    log(stderr, `reset-session: cwd already outside workspace cwd=${resolvedCwd}`);
  }

  log(stderr, `reset-session: removing workspace ${resolvedWorkspacePath}`);
  await rmPath(resolvedWorkspacePath, { recursive: true, force: true });
  log(stderr, `reset-session: removed workspace ${resolvedWorkspacePath}`);
}

function log(stream, message) {
  stream.write(`${message}\n`);
}

function formatError(error) {
  return error instanceof Error ? error.message : "unknown";
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

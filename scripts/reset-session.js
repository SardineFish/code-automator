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
  const stateFilePath = path.resolve(
    dependencies.stateFilePath ?? getCodexReuseStatePath(resolvedWorkspacePath)
  );
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
    const options = parseResetSessionArgs();
    await resetSession(options.workspacePath, { stateFilePath: options.stateFilePath });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Unknown reset-session error."}\n`);
    process.exitCode = 1;
  }
}

function parseResetSessionArgs(argv = process.argv.slice(2), cwd = process.cwd()) {
  const positional = [];
  let workspacePath;
  let stateFilePath;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }

    const workspaceOption = readOption(argument, "--workspace");
    if (workspaceOption.matched) {
      workspacePath = resolveCliPath(workspaceOption.value ?? argv[index + 1], cwd, "--workspace");
      if (workspaceOption.consumedNextValue) {
        index += 1;
      }
      continue;
    }

    const stateOption = readOption(argument, "--state");
    if (stateOption.matched) {
      stateFilePath = resolveCliPath(stateOption.value ?? argv[index + 1], cwd, "--state");
      if (stateOption.consumedNextValue) {
        index += 1;
      }
      continue;
    }

    positional.push(argument);
  }

  const resolvedWorkspacePath = workspacePath ?? resolveCliPath(positional[0] ?? cwd, cwd, "workspace path");
  return {
    workspacePath: resolvedWorkspacePath,
    stateFilePath: stateFilePath ?? getCodexReuseStatePath(resolvedWorkspacePath)
  };
}

function readOption(argument, flagName) {
  if (argument === flagName) {
    return { matched: true, consumedNextValue: true, value: undefined };
  }

  if (argument.startsWith(`${flagName}=`)) {
    return {
      matched: true,
      consumedNextValue: false,
      value: argument.slice(flagName.length + 1)
    };
  }

  return { matched: false, consumedNextValue: false, value: undefined };
}

function resolveCliPath(value, cwd, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} requires a non-empty path.`);
  }

  return path.resolve(cwd, value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

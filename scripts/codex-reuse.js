#!/usr/bin/env node

import { spawn as spawnChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const CODEX_REUSE_STATE_FILE = ".codex-reuse.json";

export function launch(codexPath, prompt, threadId, spawn, spawnOptions) {
  const commandArgs = threadId
    ? ["exec", "resume", "--json", threadId, prompt]
    : ["exec", "--json", prompt];

  return spawn(codexPath, commandArgs, spawnOptions);
}

export async function runCodexReuse(
  argv = process.argv.slice(2),
  dependencies = {}
) {
  const spawn = dependencies.spawn ?? spawnChildProcess;
  const env = dependencies.env ?? process.env;
  const defaultCwd = dependencies.cwd ?? process.cwd();
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const { codexCommand, promptArgv, stateFilePath, workspacePath } = parseCodexReuseArgs(
    argv,
    defaultCwd
  );
  const prompt = await readPrompt(promptArgv, dependencies.stdin ?? process.stdin);
  await (dependencies.mkdir ?? mkdir)(workspacePath, { recursive: true });
  const state = await readStateFile(stateFilePath, dependencies);

  let lineBuffer = "";
  let capturedThreadId = state?.threadId;

  const exitCode = await new Promise((resolve, reject) => {
    const child = launch(codexCommand, prompt, capturedThreadId, spawn, {
      cwd: workspacePath,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout.write(chunk);
      lineBuffer += chunk;
      ({ buffer: lineBuffer, threadId: capturedThreadId } = extractThreadIdFromBuffer(
        lineBuffer,
        capturedThreadId
      ));
    });

    child.stderr?.on("data", (chunk) => {
      stderr.write(chunk);
    });

    child.once("error", reject);
    child.once("close", async (code) => {
      try {
        const trailingThreadId = readThreadIdFromJsonLine(lineBuffer);
        if (trailingThreadId) {
          capturedThreadId = trailingThreadId;
        }
        if (capturedThreadId) {
          await writeStateFile(stateFilePath, capturedThreadId, dependencies);
        }
        resolve(code ?? 1);
      } catch (error) {
        reject(error);
      }
    });
  });

  return exitCode;
}

export async function readState(workspacePath, dependencies = {}) {
  return readStateFile(getCodexReuseStatePath(workspacePath), dependencies);
}

async function readStateFile(stateFilePath, dependencies = {}) {
  const resolvedStateFilePath = path.resolve(stateFilePath);

  try {
    const contents = await (dependencies.readFile ?? readFile)(resolvedStateFilePath, "utf8");
    const parsed = JSON.parse(contents);
    return typeof parsed.threadId === "string" && parsed.threadId.trim() !== ""
      ? { threadId: parsed.threadId }
      : null;
  } catch {
    return null;
  }
}

export async function writeState(workspacePath, threadId, dependencies = {}) {
  return writeStateFile(getCodexReuseStatePath(workspacePath), threadId, dependencies);
}

async function writeStateFile(stateFilePath, threadId, dependencies = {}) {
  const resolvedStateFilePath = path.resolve(stateFilePath);
  await (dependencies.mkdir ?? mkdir)(path.dirname(resolvedStateFilePath), { recursive: true });
  await (dependencies.writeFile ?? writeFile)(resolvedStateFilePath, JSON.stringify({ threadId }, null, 2));
}

export function getCodexReuseStatePath(workspacePath) {
  return path.join(workspacePath, CODEX_REUSE_STATE_FILE);
}

function parseCodexReuseArgs(argv, cwd) {
  const positional = [];
  let workspacePath = path.resolve(cwd);
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

  const [codexPath, ...promptArgv] = positional;
  return {
    codexCommand: readCodexPath(codexPath),
    promptArgv,
    stateFilePath: stateFilePath ?? getCodexReuseStatePath(workspacePath),
    workspacePath
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

function resolveCliPath(value, cwd, flagName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${flagName} requires a non-empty path.`);
  }

  return path.resolve(cwd, value);
}

function extractThreadIdFromBuffer(buffer, currentThreadId) {
  const lines = buffer.split("\n");
  const remaining = lines.pop() ?? "";
  let threadId = currentThreadId;

  for (const line of lines) {
    const nextThreadId = readThreadIdFromJsonLine(line);
    if (nextThreadId) {
      threadId = nextThreadId;
    }
  }

  return { buffer: remaining, threadId };
}

function readThreadIdFromJsonLine(line) {
  const trimmed = line.trim();
  if (trimmed === "") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed.thread_id === "string" ? parsed.thread_id : undefined;
  } catch {
    return undefined;
  }
}

function readCodexPath(argvValue) {
  if (typeof argvValue !== "string" || argvValue.trim() === "") {
    throw new Error("codex-reuse requires a codex command path as the first argument.");
  }

  return argvValue;
}

async function readPrompt(argv, stdin) {
  if (argv.length > 0 && argv[0] !== "-") {
    return argv.join(" ");
  }

  const pipedInput = await readAll(stdin);
  const prompt = argv[0] === "-" ? pipedInput : pipedInput.trim() === "" ? "" : pipedInput;

  if (prompt.trim() === "") {
    throw new Error("codex-reuse requires a prompt argument or piped stdin.");
  }

  return prompt;
}

async function readAll(stream) {
  if (stream.isTTY) {
    return "";
  }

  let contents = "";
  stream.setEncoding("utf8");
  for await (const chunk of stream) {
    contents += chunk;
  }
  return contents;
}

async function main() {
  try {
    process.exitCode = await runCodexReuse();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Unknown codex reuse error."}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

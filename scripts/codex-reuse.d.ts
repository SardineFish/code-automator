import type { Readable, Writable } from "node:stream";
import type { EventEmitter } from "node:events";

export const CODEX_REUSE_STATE_FILE: string;

export type CodexSpawn = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: ["ignore", "pipe", "pipe"];
  }
) => EventEmitter & {
  stdout?: Readable & { setEncoding(encoding: BufferEncoding): void };
  stderr?: Readable;
  once(eventName: "error" | "close", listener: (...args: unknown[]) => void): unknown;
};

export function launch(
  codexPath: string,
  prompt: string,
  threadId: string | undefined,
  spawn: CodexSpawn,
  spawnOptions: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: ["ignore", "pipe", "pipe"];
  }
): EventEmitter & {
  stdout?: Readable & { setEncoding(encoding: BufferEncoding): void };
  stderr?: Readable;
  once(eventName: "error" | "close", listener: (...args: unknown[]) => void): unknown;
};

export function runCodexReuse(
  argv?: string[],
  dependencies?: {
    spawn?: CodexSpawn;
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    stdout?: Writable;
    stderr?: Writable;
    stdin?: Readable;
    readFile?: typeof import("node:fs/promises").readFile;
    writeFile?: typeof import("node:fs/promises").writeFile;
    mkdir?: typeof import("node:fs/promises").mkdir;
  }
): Promise<number>;

export function readState(
  workspacePath: string,
  dependencies?: {
    readFile?: typeof import("node:fs/promises").readFile;
  }
): Promise<{ threadId: string } | null>;

export function writeState(
  workspacePath: string,
  threadId: string,
  dependencies?: {
    writeFile?: typeof import("node:fs/promises").writeFile;
    mkdir?: typeof import("node:fs/promises").mkdir;
  }
): Promise<void>;

export function getCodexReuseStatePath(workspacePath: string): string;

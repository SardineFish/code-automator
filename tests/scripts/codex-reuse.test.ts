import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  CODEX_REUSE_STATE_FILE,
  launch,
  runCodexReuse
} from "../../scripts/codex-reuse.js";

const CODEX_COMMAND = "/path/to/codex";

test("launch starts codex in the workspace and resumes when a thread id exists", () => {
  const spawned: Array<{
    command: string;
    args: string[];
    options: {
      cwd: string;
      env: NodeJS.ProcessEnv;
      stdio: ["ignore", "pipe", "pipe"];
    };
  }> = [];
  const child = createFakeChild();
  const env = { TEST_ENV: "1" };
  const spawnOptions: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: ["ignore", "pipe", "pipe"];
  } = {
    cwd: "/tmp/reusable-issue",
    env,
    stdio: ["ignore", "pipe", "pipe"]
  };

  const launched = launch(CODEX_COMMAND, "Continue the issue", "thread-456", (command: string, args: string[], options) => {
    spawned.push({ command, args, options });
    return child;
  }, spawnOptions);

  assert.equal(launched, child);
  assert.deepEqual(spawned, [
    {
      command: CODEX_COMMAND,
      args: ["exec", "resume", "--json", "thread-456", "Continue the issue"],
      options: spawnOptions
    }
  ]);
});

test("codex-reuse stores the first thread_id emitted by codex exec --json", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gao-codex-reuse-"));
  const spawned: Array<{ command: string; args: string[] }> = [];
  const stdout = new PassThrough();
  let output = "";

  stdout.setEncoding("utf8");
  stdout.on("data", (chunk) => {
    output += chunk;
  });

  const exitCode = await runCodexReuse([CODEX_COMMAND, "Plan issue 7"], {
    cwd: dir,
    stdout,
    stderr: new PassThrough(),
    spawn(command: string, args: string[]) {
      spawned.push({ command, args });
      return createFakeChild({
        stdoutLines: [
          '{"type":"thread.started","thread_id":"thread-123"}',
          '{"type":"message","content":"done"}'
        ]
      });
    }
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(spawned, [
    {
      command: CODEX_COMMAND,
      args: ["exec", "--json", "Plan issue 7"]
    }
  ]);
  assert.match(output, /thread-123/);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(dir, CODEX_REUSE_STATE_FILE), "utf8")),
    { threadId: "thread-123" }
  );
});

test("codex-reuse resumes the saved session when metadata already exists", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gao-codex-resume-"));
  await writeFile(
    path.join(dir, CODEX_REUSE_STATE_FILE),
    JSON.stringify({ threadId: "thread-456" }, null, 2)
  );

  const spawned: Array<{ command: string; args: string[] }> = [];
  const exitCode = await runCodexReuse([CODEX_COMMAND, "Continue the issue"], {
    cwd: dir,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    spawn(command: string, args: string[]) {
      spawned.push({ command, args });
      return createFakeChild();
    }
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(spawned, [
    {
      command: CODEX_COMMAND,
      args: ["exec", "resume", "--json", "thread-456", "Continue the issue"]
    }
  ]);
});

test("codex-reuse requires a codex command path before the prompt", async () => {
  await assert.rejects(() => runCodexReuse([]), {
    message: "codex-reuse requires a codex command path as the first argument."
  });
});

function createFakeChild(options: { stdoutLines?: string[]; exitCode?: number } = {}) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();

  queueMicrotask(() => {
    for (const line of options.stdoutLines ?? []) {
      child.stdout.write(`${line}\n`);
    }
    child.stdout.end();
    child.stderr.end();
    child.emit("close", options.exitCode ?? 0);
  });

  return child;
}

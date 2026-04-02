import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { shellProcessRunner } from "../../../src/providers/process/process-runner.js";

test("shellProcessRunner rejects spawn failures", async () => {
  await assert.rejects(
    () =>
      shellProcessRunner.run("echo hi", {
        env: process.env,
        cwd: "/path/that/does/not/exist"
      }),
    /ENOENT/
  );
});

test("shellProcessRunner escalates timed-out processes", async () => {
  const result = await shellProcessRunner.run("trap '' TERM; while :; do sleep 1; done", {
    env: process.env,
    cwd: process.cwd(),
    timeoutMs: 25
  });

  assert.equal(result.timedOut, true);
  assert.ok(result.signal === "SIGTERM" || result.signal === "SIGKILL");
});

test("shellProcessRunner starts detached processes and reads their result files", async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), "gao-process-"));
  await mkdir(runDir, { recursive: true });
  const artifacts = {
    runDir,
    wrapperScriptPath: path.join(runDir, "run.sh"),
    pidFilePath: path.join(runDir, "wrapper.pid"),
    resultFilePath: path.join(runDir, "result.json"),
    stdoutPath: path.join(runDir, "stdout.log"),
    stderrPath: path.join(runDir, "stderr.log")
  };
  const started = await shellProcessRunner.startDetached("sleep 0.1 && echo hello", {
    artifacts,
    env: process.env,
    cwd: process.cwd()
  });

  assert.ok(started.pid > 0);

  const result = await waitForResult(async () =>
    shellProcessRunner.readDetachedResult(artifacts.resultFilePath)
  );

  assert.ok(result);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdoutPath, artifacts.stdoutPath);
  assert.equal(result.stderrPath, artifacts.stderrPath);
});

test("shellProcessRunner startDetached rejects invalid spawn targets", async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), "gao-process-bad-"));
  const artifacts = {
    runDir,
    wrapperScriptPath: path.join(runDir, "missing", "run.sh"),
    pidFilePath: path.join(runDir, "wrapper.pid"),
    resultFilePath: path.join(runDir, "result.json"),
    stdoutPath: path.join(runDir, "stdout.log"),
    stderrPath: path.join(runDir, "stderr.log")
  };

  await assert.rejects(
    () =>
      shellProcessRunner.startDetached("echo hello", {
        artifacts,
        env: process.env,
        cwd: process.cwd()
      }),
    /ENOENT|no such file/i
  );
});

async function waitForResult<T>(read: () => Promise<T | null>, timeoutMs = 2000): Promise<T> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result = await read();

    if (result) {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("Timed out waiting for detached process result.");
}

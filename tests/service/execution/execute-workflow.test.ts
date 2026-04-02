import assert from "node:assert/strict";
import test from "node:test";

import { executeWorkflow } from "../../../src/service/execution/execute-workflow.js";
import { createServiceConfig } from "../../fixtures/service-config.js";

const artifacts = {
  runDir: "/tmp/run-1",
  wrapperScriptPath: "/tmp/run-1/run.sh",
  pidFilePath: "/tmp/run-1/wrapper.pid",
  resultFilePath: "/tmp/run-1/result.json",
  stdoutPath: "/tmp/run-1/stdout.log",
  stderrPath: "/tmp/run-1/stderr.log"
};

test("executeWorkflow shell-escapes prompt and injects the installation token", async () => {
  const config = createServiceConfig();
  config.workspace.enabled = true;
  config.executors.codex.run = "codex -w ${workspace} exec ${prompt}";

  const calls: {
    command?: string;
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    timeoutMs?: number;
    artifacts?: typeof artifacts;
  } = {};
  const result = await executeWorkflow({
    config,
    executorName: "codex",
    prompt: "O'Hara",
    artifacts,
    installationToken: "installation-token",
    workspaceRepo: {
      async createRunWorkspace() {
        return "/tmp/workspace-1";
      },
      async removeWorkspace() {}
    },
    processRunner: {
      async run() {
        throw new Error("should not be called");
      },
      async startDetached(command, options) {
        calls.command = command;
        calls.env = options.env;
        calls.cwd = options.cwd;
        calls.timeoutMs = options.timeoutMs;
        calls.artifacts = options.artifacts;
        return { pid: 4242, startedAt: "2026-04-02T00:00:00.000Z" };
      },
      isProcessRunning() {
        return true;
      },
      async readDetachedResult() {
        return null;
      }
    },
    baseEnv: { BASE: "1" }
  });

  assert.equal(result.status, "running");
  assert.equal(result.pid, 4242);
  assert.equal(result.command, "codex -w '/tmp/workspace-1' exec 'O'\"'\"'Hara'");
  assert.equal(calls.cwd, "/tmp/workspace-1");
  assert.equal(calls.env?.BASE, "1");
  assert.equal(calls.env?.EXECUTOR, "codex");
  assert.equal(calls.env?.GITHUB_TOKEN, "installation-token");
  assert.equal(calls.timeoutMs, 900000);
  assert.deepEqual(calls.artifacts, artifacts);
});

test("executeWorkflow throws for unknown executors", async () => {
  await assert.rejects(
    () =>
      executeWorkflow({
        config: createServiceConfig(),
        executorName: "missing",
        prompt: "noop",
        artifacts,
        installationToken: "installation-token",
        workspaceRepo: {
          async createRunWorkspace() {
            throw new Error("should not be called");
          },
          async removeWorkspace() {}
        },
        processRunner: {
          async run() {
            throw new Error("should not be called");
          },
          async startDetached() {
            throw new Error("should not be called");
          },
          isProcessRunning() {
            return false;
          },
          async readDetachedResult() {
            return null;
          }
        }
      }),
    /Unknown executor/
  );
});

test("executeWorkflow reports workspace creation failures", async () => {
  await assert.rejects(
    () =>
      executeWorkflow({
        config: {
          ...createServiceConfig(),
          workspace: { enabled: true, baseDir: "/tmp", cleanupAfterRun: true }
        },
        executorName: "codex",
        prompt: "noop",
        artifacts,
        installationToken: "installation-token",
        workspaceRepo: {
          async createRunWorkspace() {
            throw new Error("mkdir failed");
          },
          async removeWorkspace() {}
        },
        processRunner: {
          async run() {
            throw new Error("should not be called");
          },
          async startDetached() {
            throw new Error("should not be called");
          },
          isProcessRunning() {
            return false;
          },
          async readDetachedResult() {
            return null;
          }
        }
      }),
    /mkdir failed/
  );
});

test("executeWorkflow reports cleanup failures after launch failure", async () => {
  await assert.rejects(
    () =>
      executeWorkflow({
        config: {
          ...createServiceConfig(),
          workspace: { enabled: true, baseDir: "/tmp", cleanupAfterRun: true }
        },
        executorName: "codex",
        prompt: "noop",
        artifacts,
        installationToken: "installation-token",
        workspaceRepo: {
          async createRunWorkspace() {
            return "/tmp/run-2";
          },
          async removeWorkspace() {
            throw new Error("cleanup failed");
          }
        },
        processRunner: {
          async run() {
            throw new Error("should not be called");
          },
          async startDetached() {
            throw new Error("spawn failed");
          },
          isProcessRunning() {
            return false;
          },
          async readDetachedResult() {
            return null;
          }
        }
      }),
    /Workspace cleanup failed: cleanup failed/
  );
});

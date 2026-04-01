import assert from "node:assert/strict";
import test from "node:test";

import { executeWorkflow } from "../../../src/service/execution/execute-workflow.js";
import { createServiceConfig } from "../../fixtures/service-config.js";

test("executeWorkflow shell-escapes prompt and workspace and cleans up workspaces", async () => {
  const config = createServiceConfig();
  config.workspace.enabled = true;
  config.workspace.cleanupAfterRun = true;
  config.executors.codex.run = "codex -w ${workspace} exec ${prompt}";

  const calls: { command?: string; env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number; removed?: string } = {};
  const result = await executeWorkflow({
    config,
    executorName: "codex",
    prompt: "O'Hara",
    workspaceRepo: {
      async createRunWorkspace() {
        return "/tmp/run-1";
      },
      async removeWorkspace(path) {
        calls.removed = path;
      }
    },
    processRunner: {
      async run(command, options) {
        calls.command = command;
        calls.env = options.env;
        calls.cwd = options.cwd;
        calls.timeoutMs = options.timeoutMs;
        return { exitCode: 0, signal: null, stdout: "ok", stderr: "", timedOut: false };
      }
    },
    baseEnv: { BASE: "1" }
  });

  assert.equal(result.status, "success");
  assert.equal(calls.command, "codex -w '/tmp/run-1' exec 'O'\"'\"'Hara'");
  assert.equal(calls.cwd, "/tmp/run-1");
  assert.equal(calls.env?.BASE, "1");
  assert.equal(calls.env?.EXECUTOR, "codex");
  assert.equal(calls.timeoutMs, 900000);
  assert.equal(calls.removed, "/tmp/run-1");
});

test("executeWorkflow returns an error result for unknown executors", async () => {
  const result = await executeWorkflow({
    config: createServiceConfig(),
    executorName: "missing",
    prompt: "noop",
    workspaceRepo: {
      async createRunWorkspace() {
        throw new Error("should not be called");
      },
      async removeWorkspace() {}
    },
    processRunner: {
      async run() {
        throw new Error("should not be called");
      }
    }
  });

  assert.equal(result.status, "error");
  assert.match(result.errorMessage ?? "", /Unknown executor/);
});

test("executeWorkflow returns structured errors when workspace creation fails", async () => {
  const result = await executeWorkflow({
    config: { ...createServiceConfig(), workspace: { enabled: true, baseDir: "/tmp", cleanupAfterRun: true } },
    executorName: "codex",
    prompt: "noop",
    workspaceRepo: {
      async createRunWorkspace() {
        throw new Error("mkdir failed");
      },
      async removeWorkspace() {}
    },
    processRunner: {
      async run() {
        throw new Error("should not be called");
      }
    }
  });

  assert.equal(result.status, "error");
  assert.match(result.errorMessage ?? "", /mkdir failed/);
});

test("executeWorkflow reports cleanup failures as structured errors", async () => {
  const config = createServiceConfig();
  config.workspace.enabled = true;
  config.workspace.cleanupAfterRun = true;

  const result = await executeWorkflow({
    config,
    executorName: "codex",
    prompt: "noop",
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
        return { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false };
      }
    }
  });

  assert.equal(result.status, "error");
  assert.match(result.errorMessage ?? "", /Workspace cleanup failed: cleanup failed/);
});

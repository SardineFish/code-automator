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
  config.configDir = "/tmp/service-config";
  config.workspace.enabled = false;
  config.executors.codex.run =
    "${env.NODE_BIN} ${configDir}/codex-wrapper.js -w ${workspace} --base ${env.BASE} --executor ${env.EXECUTOR} --shared ${env.SHARED} --trigger ${env.TRIGGER_ONLY} --token ${env.GH_TOKEN} exec ${prompt}";
  config.executors.codex.env.SHARED = "executor";
  config.executors.codex.workspace = "/tmp/custom-parent";

  const calls: {
    command?: string;
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    timeoutMs?: number;
    artifacts?: typeof artifacts;
    workspaceBaseDir?: string;
  } = {};
  const result = await executeWorkflow({
    config,
    executorName: "codex",
    prompt: "O'Hara",
    artifacts,
    installationToken: "installation-token",
    triggerEnv: {
      SHARED: "trigger",
      TRIGGER_ONLY: "1"
    },
    workspaceRepo: {
      async createRunWorkspace(baseDir) {
        calls.workspaceBaseDir = baseDir;
        return "/tmp/workspace-1";
      },
      async ensureReusableWorkspace() {
        throw new Error("should not be called");
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
  assert.equal(
    result.command,
    `'${process.execPath}' '/tmp/service-config'/codex-wrapper.js -w '/tmp/workspace-1' --base '1' --executor 'codex' --shared 'trigger' --trigger '1' --token 'installation-token' exec 'O'"'"'Hara'`
  );
  assert.equal(calls.workspaceBaseDir, "/tmp/custom-parent");
  assert.equal(calls.cwd, "/tmp/workspace-1");
  assert.equal(calls.env?.BASE, "1");
  assert.equal(calls.env?.EXECUTOR, "codex");
  assert.equal(calls.env?.SHARED, "trigger");
  assert.equal(calls.env?.TRIGGER_ONLY, "1");
  assert.equal(calls.env?.GH_TOKEN, "installation-token");
  assert.equal(calls.timeoutMs, 900000);
  assert.deepEqual(calls.artifacts, artifacts);
});

test("executeWorkflow reuses a keyed workspace and renders ${workspaceKey}", async () => {
  const config = createServiceConfig();
  config.workspace.enabled = false;
  config.executors.codex.run = "${configDir}/codex -w ${workspace} --key ${workspaceKey} exec ${prompt}";
  config.executors.codex.workspace = {
    baseDir: "/tmp/reusable-workspaces",
    key: "${in.repo}#${in.issueId}"
  };

  const calls: {
    command?: string;
    cwd?: string;
    directoryName?: string;
    removedWorkspace?: string;
  } = {};
  const result = await executeWorkflow({
    config,
    executorName: "codex",
    prompt: "Continue work",
    artifacts,
    workspaceKey: "acme/demo#7",
    workspaceRepo: {
      async createRunWorkspace() {
        throw new Error("should not be called");
      },
      async ensureReusableWorkspace(baseDir, directoryName) {
        assert.equal(baseDir, "/tmp/reusable-workspaces");
        calls.directoryName = directoryName;
        return `/tmp/reusable-workspaces/${directoryName}`;
      },
      async removeWorkspace(workspacePath) {
        calls.removedWorkspace = workspacePath;
      }
    },
    processRunner: {
      async run() {
        throw new Error("should not be called");
      },
      async startDetached(command, options) {
        calls.command = command;
        calls.cwd = options.cwd;
        return { pid: 4243, startedAt: "2026-04-02T00:00:00.000Z" };
      },
      isProcessRunning() {
        return true;
      },
      async readDetachedResult() {
        return null;
      }
    }
  });

  assert.equal(result.workspacePath, "/tmp/reusable-workspaces/acme_demo#7");
  assert.equal(calls.directoryName, "acme_demo#7");
  assert.equal(calls.cwd, "/tmp/reusable-workspaces/acme_demo#7");
  assert.equal(
    calls.command,
    "'/tmp/github-agent-orchestrator/config'/codex -w '/tmp/reusable-workspaces/acme_demo#7' --key 'acme/demo#7' exec 'Continue work'"
  );
  assert.equal(calls.removedWorkspace, undefined);
});

test("executeWorkflow skips workspace creation when the executor disables it", async () => {
  const config = createServiceConfig();
  config.workspace.enabled = true;
  config.executors.codex.workspace = false;

  let createdWorkspace = false;
  let cwd: string | undefined;
  const result = await executeWorkflow({
    config,
    executorName: "codex",
    prompt: "noop",
    artifacts,
    workspaceRepo: {
      async createRunWorkspace() {
        createdWorkspace = true;
        return "/tmp/workspace-should-not-exist";
      },
      async ensureReusableWorkspace() {
        createdWorkspace = true;
        return "/tmp/workspace-should-not-exist";
      },
      async removeWorkspace() {}
    },
    processRunner: {
      async run() {
        throw new Error("should not be called");
      },
      async startDetached(_command, options) {
        cwd = options.cwd;
        return { pid: 4343, startedAt: "2026-04-02T00:00:00.000Z" };
      },
      isProcessRunning() {
        return true;
      },
      async readDetachedResult() {
        return null;
      }
    }
  });

  assert.equal(createdWorkspace, false);
  assert.equal(result.workspacePath, "");
  assert.equal(cwd, process.cwd());
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
          async ensureReusableWorkspace() {
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
          workspace: { enabled: false, baseDir: "/tmp", cleanupAfterRun: true },
          executors: {
            ...createServiceConfig().executors,
            codex: {
              ...createServiceConfig().executors.codex,
              workspace: true
            }
          }
        },
        executorName: "codex",
        prompt: "noop",
        artifacts,
        installationToken: "installation-token",
        workspaceRepo: {
          async createRunWorkspace() {
            throw new Error("mkdir failed");
          },
          async ensureReusableWorkspace() {
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
          workspace: { enabled: false, baseDir: "/tmp", cleanupAfterRun: true },
          executors: {
            ...createServiceConfig().executors,
            codex: {
              ...createServiceConfig().executors.codex,
              workspace: true
            }
          }
        },
        executorName: "codex",
        prompt: "noop",
        artifacts,
        installationToken: "installation-token",
        workspaceRepo: {
          async createRunWorkspace() {
            return "/tmp/run-2";
          },
          async ensureReusableWorkspace() {
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

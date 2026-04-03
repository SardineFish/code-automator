import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { App } from "../../src/app/app.js";
import { githubProvider } from "../../src/app/providers/github-provider.js";
import {
  issueClosedPayload,
  issueCommentPayload,
  issueOpenedPayload,
  reviewCommentPayload,
  reviewPayload
} from "../fixtures/github-webhooks.js";
import {
  createMemoryLogSink,
  createNoOpLogSink,
  type CapturedLogRecord
} from "../fixtures/log-sink.js";
import { createServiceConfig } from "../fixtures/service-config.js";
import type { AppConfig } from "../../src/types/config.js";
import type { LogSink } from "../../src/types/logging.js";
import type {
  AppContextTerminalListeners,
  WorkflowCompletedEventPayload,
  WorkflowErrorEventPayload
} from "../../src/types/runtime.js";
import type { ActiveWorkflowRunRecord, WorkflowRunArtifacts } from "../../src/types/tracking.js";

function createQueuedRunRecord(
  runId: string,
  context: Partial<ActiveWorkflowRunRecord> = {}
): ActiveWorkflowRunRecord {
  const artifacts: WorkflowRunArtifacts = {
    runDir: `/tmp/${runId}`,
    wrapperScriptPath: `/tmp/${runId}/run.sh`,
    pidFilePath: `/tmp/${runId}/wrapper.pid`,
    resultFilePath: `/tmp/${runId}/result.json`,
    stdoutPath: `/tmp/${runId}/stdout.log`,
    stderrPath: `/tmp/${runId}/stderr.log`
  };

  return {
    runId,
    status: "queued",
    createdAt: "2026-04-02T00:00:00.000Z",
    updatedAt: "2026-04-02T00:00:00.000Z",
    source: "/gh-hook",
    workflowName: "issue-plan",
    matchedTrigger: "issue:open",
    executorName: "codex",
    workspacePath: "",
    artifacts,
    ...context
  };
}

test("GitHub provider rejects invalid signatures", async (t) => {
  const { url } = await startGitHubApp(t);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "issue_comment",
      "x-hub-signature-256": "sha256=bad"
    },
    body: JSON.stringify(issueCommentPayload("@github-agent-orchestrator /plan"))
  });

  assert.equal(response.status, 401);
});

test("GitHub provider ignores whitelist rejections without launching workflows", async (t) => {
  const payload = issueCommentPayload("@github-agent-orchestrator /plan", { senderLogin: "intruder" });
  const { reactionCalls, started, url } = await startGitHubApp(t);

  const response = await signedRequest(url, payload, "issue_comment");

  assert.equal(response.status, 202);
  assert.deepEqual(started, []);
  assert.deepEqual(reactionCalls, []);
});

test("GitHub provider ignores plain issue comments without a leading mention", async (t) => {
  const { reactionCalls, started, url } = await startGitHubApp(t);
  const response = await signedRequest(url, issueCommentPayload("please plan this"), "issue_comment");

  assert.equal(response.status, 202);
  assert.deepEqual(started, []);
  assert.deepEqual(reactionCalls, []);
});

test("GitHub provider routes plain issue comments when requireMention is false", async (t) => {
  const { commands, reactionCalls, started, url } = await startGitHubApp(t, {
    customizeConfig(config) {
      if (!config.gh) {
        throw new Error("Missing test GitHub config.");
      }

      config.gh.requireMention = false;
      config.workflow[2] = {
        name: "issue-comment",
        on: ["issue:comment"],
        use: "codex",
        prompt: "Comment ${in.content}"
      };
    }
  });
  const response = await signedRequest(url, issueCommentPayload("please plan this"), "issue_comment");

  assert.equal(response.status, 202);
  await waitForCondition(() => started.length === 1);
  assert.deepEqual(commands, ["codex exec 'Comment please plan this'"]);
  assert.deepEqual(started, ["codex exec 'Comment please plan this'"]);
  assert.deepEqual(reactionCalls, [
    "POST https://api.github.com/repos/acme/demo/issues/comments/99/reactions eyes"
  ]);
});

test("GitHub provider treats unsupported slash issue commands as generic mentions", async (t) => {
  const { commands, commentCalls, reactionCalls, started, url } = await startGitHubApp(t);
  const response = await signedRequest(
    url,
    issueCommentPayload("@github-agent-orchestrator /go"),
    "issue_comment"
  );

  assert.equal(response.status, 202);
  await waitForCondition(() => started.length === 1);
  assert.deepEqual(commands, ["codex exec 'Handle /go'"]);
  assert.deepEqual(started, ["codex exec 'Handle /go'"]);
  assert.deepEqual(commentCalls, []);
  assert.deepEqual(reactionCalls, [
    "POST https://api.github.com/repos/acme/demo/issues/comments/99/reactions eyes"
  ]);
});

test("GitHub provider treats bare issue command names as generic mentions", async (t) => {
  const { commands, started, url } = await startGitHubApp(t);
  const response = await signedRequest(
    url,
    issueCommentPayload("@github-agent-orchestrator plan"),
    "issue_comment"
  );

  assert.equal(response.status, 202);
  await waitForCondition(() => started.length === 1);
  assert.deepEqual(commands, ["codex exec 'Handle plan'"]);
  assert.deepEqual(started, ["codex exec 'Handle plan'"]);
});

test("GitHub provider accepts bare slash issue commands when requireMention is false", async (t) => {
  const { commands, started, url } = await startGitHubApp(t, {
    customizeConfig(config) {
      if (!config.gh) {
        throw new Error("Missing test GitHub config.");
      }

      config.gh.requireMention = false;
    }
  });
  const response = await signedRequest(url, issueCommentPayload("/plan"), "issue_comment");

  assert.equal(response.status, 202);
  await waitForCondition(() => started.length === 1);
  assert.deepEqual(commands, ["codex exec 'Plan issue 7'"]);
  assert.deepEqual(started, ["codex exec 'Plan issue 7'"]);
});

test("GitHub provider routes /reset as an issue command while the issue is open", async (t) => {
  const { commands, started, url } = await startGitHubApp(t, {
    customizeConfig(config) {
      config.workflow = [
        {
          name: "issue-reset",
          on: ["issue:command:reset"],
          use: "codex",
          prompt: "Reset issue ${in.issueId}"
        },
        ...config.workflow
      ];
    }
  });

  const response = await signedRequest(url, issueCommentPayload("@github-agent-orchestrator /reset"), "issue_comment");

  assert.equal(response.status, 202);
  await waitForCondition(() => started.length === 1);
  assert.deepEqual(commands, ["codex exec 'Reset issue 7'"]);
  assert.deepEqual(started, ["codex exec 'Reset issue 7'"]);
});

test("GitHub provider routes issues.closed to issue:close workflows", async (t) => {
  const { commands, started, url } = await startGitHubApp(t, {
    customizeConfig(config) {
      config.workflow = [
        {
          name: "issue-close",
          on: ["issue:close"],
          use: "codex",
          prompt: "Close issue ${in.issueId}"
        },
        ...config.workflow
      ];
    }
  });

  const response = await signedRequest(url, issueClosedPayload(), "issues");

  assert.equal(response.status, 202);
  await waitForCondition(() => started.length === 1);
  assert.deepEqual(commands, ["codex exec 'Close issue 7'"]);
  assert.deepEqual(started, ["codex exec 'Close issue 7'"]);
});

test("GitHub provider ignores closed issue comments instead of dispatching normal issue workflows", async (t) => {
  const { commands, started, url } = await startGitHubApp(t, {
    customizeConfig(config) {
      config.workflow = [
        {
          name: "issue-reset",
          on: ["issue:command:reset"],
          use: "codex",
          prompt: "Reset issue ${in.issueId}"
        },
        ...config.workflow
      ];
    }
  });

  const response = await signedRequest(
    url,
    issueCommentPayload("@github-agent-orchestrator /reset", { issueState: "closed" }),
    "issue_comment"
  );

  assert.equal(response.status, 202);
  assert.deepEqual(commands, []);
  assert.deepEqual(started, []);
});

test("GitHub provider emits issue:at for inline mentions", async (t) => {
  const { commands, started, url } = await startGitHubApp(t);
  const response = await signedRequest(
    url,
    issueCommentPayload("please @github-agent-orchestrator summarize"),
    "issue_comment"
  );

  assert.equal(response.status, 202);
  await waitForCondition(() => started.length === 1);
  assert.deepEqual(commands, ["codex exec 'Handle please @github-agent-orchestrator summarize'"]);
  assert.deepEqual(started, ["codex exec 'Handle please @github-agent-orchestrator summarize'"]);
});

test("GitHub provider emits pr:at for mentioned PR comments and review comments", async (t) => {
  const { commands, started, url } = await startGitHubApp(t, {
    customizeConfig(config) {
      config.workflow = [
        {
          name: "pr-at",
          on: ["pr:at"],
          use: "codex",
          prompt: "At PR ${in.prId}: ${in.content}"
        },
        ...config.workflow
      ];
    }
  });
  const scenarios = [
    {
      eventName: "issue_comment",
      payload: issueCommentPayload("please @github-agent-orchestrator review", { pullRequest: true }),
      expectedCommand: "codex exec 'At PR 7: please @github-agent-orchestrator review'"
    },
    {
      eventName: "pull_request_review_comment",
      payload: reviewCommentPayload("please @github-agent-orchestrator review"),
      expectedCommand: "codex exec 'At PR 8: please @github-agent-orchestrator review'"
    }
  ];

  for (const scenario of scenarios) {
    const response = await signedRequest(url, scenario.payload, scenario.eventName);
    assert.equal(response.status, 202);
  }

  await waitForCondition(() => started.length === scenarios.length);
  assert.deepEqual(commands, scenarios.map((scenario) => scenario.expectedCommand));
  assert.deepEqual(started, scenarios.map((scenario) => scenario.expectedCommand));
});

test("GitHub provider preserves multi-line PR mention content", async (t) => {
  const { commands, started, url } = await startGitHubApp(t, {
    customizeConfig(config) {
      config.workflow = [
        {
          name: "pr-at",
          on: ["pr:at"],
          use: "codex",
          prompt: "At PR ${in.prId}: ${in.content}"
        },
        ...config.workflow
      ];
    }
  });
  const response = await signedRequest(
    url,
    reviewCommentPayload("@github-agent-orchestrator review this\nwith more context"),
    "pull_request_review_comment"
  );

  assert.equal(response.status, 202);
  await waitForCondition(() => started.length === 1);
  assert.deepEqual(commands, ["codex exec 'At PR 8: review this\nwith more context'"]);
  assert.deepEqual(started, ["codex exec 'At PR 8: review this\nwith more context'"]);
});

test("GitHub provider ignores approved PR reviews by default", async (t) => {
  const logRecords: CapturedLogRecord[] = [];
  const { commands, reactionCalls, started, url } = await startGitHubApp(t, {
    logSink: createMemoryLogSink(logRecords)
  });
  const response = await signedRequest(url, reviewPayload("ship it", "approved"), "pull_request_review");

  assert.equal(response.status, 202);
  assert.deepEqual(commands, []);
  assert.deepEqual(started, []);
  assert.deepEqual(reactionCalls, []);
  assert.ok(
    logRecords.some(
      (record) =>
        record.message === "processed webhook delivery" &&
        record.status === "ignored" &&
        record.reason === "approved_review_ignored"
    )
  );
});

test("GitHub provider routes approved PR reviews when ignoreApprovalReview is false", async (t) => {
  const { commands, reactionCalls, started, url } = await startGitHubApp(t, {
    customizeConfig(config) {
      if (!config.gh) {
        throw new Error("Missing test GitHub config.");
      }

      config.gh.ignoreApprovalReview = false;
    }
  });
  const response = await signedRequest(url, reviewPayload("ship it", "approved"), "pull_request_review");

  assert.equal(response.status, 202);
  await waitForCondition(() => started.length === 1);
  assert.deepEqual(commands, ["codex exec 'Review PR 8: ship it'"]);
  assert.deepEqual(started, ["codex exec 'Review PR 8: ship it'"]);
  assert.deepEqual(reactionCalls, ["POST https://api.github.com/graphql EYES PRR_kwDOdemo202"]);
});

test("GitHub provider keeps changes-requested reviews actionable", async (t) => {
  const { commands, reactionCalls, started, url } = await startGitHubApp(t);
  const response = await signedRequest(url, reviewPayload("", "changes_requested"), "pull_request_review");

  assert.equal(response.status, 202);
  await waitForCondition(() => started.length === 1);
  assert.deepEqual(commands, ["codex exec 'Review PR 8: request-changes'"]);
  assert.deepEqual(started, ["codex exec 'Review PR 8: request-changes'"]);
  assert.deepEqual(reactionCalls, ["POST https://api.github.com/graphql EYES PRR_kwDOdemo202"]);
});

test("GitHub provider routes the documented workflows through the provider app", async (t) => {
  const { commands, commentCalls, envs, reactionCalls, started, url } = await startGitHubApp(t);
  const scenarios = [
    {
      name: "issue-plan",
      eventName: "issues",
      payload: issueOpenedPayload(),
      expectedCommand: "codex exec 'Plan issue 7'"
    },
    {
      name: "issue-implement",
      eventName: "issue_comment",
      payload: issueCommentPayload("@github-agent-orchestrator /approve"),
      expectedCommand: "claude exec 'Implement issue 7'"
    },
    {
      name: "issue-at",
      eventName: "issue_comment",
      payload: issueCommentPayload("@github-agent-orchestrator please summarize"),
      expectedCommand: "codex exec 'Handle please summarize'"
    },
    {
      name: "pr-comment",
      eventName: "issue_comment",
      payload: issueCommentPayload("looks good", { pullRequest: true }),
      expectedCommand: "codex exec 'Review PR 7: looks good'"
    },
    {
      name: "pr-review",
      eventName: "pull_request_review",
      payload: reviewPayload("", "changes_requested"),
      expectedCommand: "codex exec 'Review PR 8: request-changes'"
    },
    {
      name: "pr-review-comment",
      eventName: "pull_request_review_comment",
      payload: reviewCommentPayload("needs work"),
      expectedCommand: "codex exec 'Review PR 8: needs work'"
    }
  ];

  for (const scenario of scenarios) {
    const response = await signedRequest(url, scenario.payload, scenario.eventName);
    assert.equal(response.status, 202, scenario.name);
  }

  await waitForCondition(() => started.length === scenarios.length);
  assert.deepEqual(commands, scenarios.map((scenario) => scenario.expectedCommand));
  assert.deepEqual(started, scenarios.map((scenario) => scenario.expectedCommand));
  assert.ok(envs.every((env) => env.GH_TOKEN === "installation-token"));
  assert.deepEqual(commentCalls, []);
  assert.deepEqual(reactionCalls, [
    "POST https://api.github.com/repos/acme/demo/issues/7/reactions eyes",
    "POST https://api.github.com/repos/acme/demo/issues/comments/99/reactions eyes",
    "POST https://api.github.com/repos/acme/demo/issues/comments/99/reactions eyes",
    "POST https://api.github.com/repos/acme/demo/issues/comments/99/reactions eyes",
    "POST https://api.github.com/graphql EYES PRR_kwDOdemo202",
    "POST https://api.github.com/repos/acme/demo/pulls/comments/101/reactions eyes"
  ]);
});

test("GitHub provider reports issue-path runtime failures on the issue thread", async (t) => {
  const { commentCalls, reactionCalls, started, url } = await startGitHubApp(t, {
    createQueuedRunError: new Error("queue failed")
  });
  const response = await signedRequest(url, issueOpenedPayload(), "issues");

  assert.equal(response.status, 500);
  assert.deepEqual(started, []);
  assert.deepEqual(reactionCalls, []);
  assert.equal(commentCalls.length, 1);
  assert.match(commentCalls[0] ?? "", /^POST https:\/\/api\.github\.com\/repos\/acme\/demo\/issues\/7\/comments /);
  assert.match(commentCalls[0] ?? "", /Error: queue failed/);
  assert.match(commentCalls[0] ?? "", /\bat\b/);
});

test("GitHub provider reports PR-path runtime failures on the PR thread", async (t) => {
  const { commentCalls, reactionCalls, started, url } = await startGitHubApp(t, {
    createQueuedRunError: new Error("queue failed")
  });
  const response = await signedRequest(url, reviewPayload("needs work", "changes_requested"), "pull_request_review");

  assert.equal(response.status, 500);
  assert.deepEqual(started, []);
  assert.deepEqual(reactionCalls, []);
  assert.equal(commentCalls.length, 1);
  assert.match(commentCalls[0] ?? "", /^POST https:\/\/api\.github\.com\/repos\/acme\/demo\/issues\/8\/comments /);
  assert.match(commentCalls[0] ?? "", /Error: queue failed/);
  assert.match(commentCalls[0] ?? "", /\bat\b/);
});

test("GitHub provider reports queued terminal failures on the same thread", async (t) => {
  const { commentCalls, emitTrackedError, installationTokenCalls, reactionCalls, started, url } =
    await startGitHubApp(t);
  const response = await signedRequest(
    url,
    issueCommentPayload("@github-agent-orchestrator /approve"),
    "issue_comment"
  );

  assert.equal(response.status, 202);
  await waitForCondition(() => started.length === 1);
  assert.deepEqual(commentCalls, []);
  assert.equal(installationTokenCalls.length, 1);
  assert.deepEqual(reactionCalls, [
    "POST https://api.github.com/repos/acme/demo/issues/comments/99/reactions eyes"
  ]);

  await emitTrackedError("run-1", {
    runId: "run-1",
    workflowName: "issue-implement",
    matchedTrigger: "issue:command:approve",
    executorName: "claude",
    completedAt: "2026-04-02T00:00:10.000Z",
    status: "failed",
    error: new Error("Workflow exited with code 17.")
  });

  await waitForCondition(() => commentCalls.length === 1 && reactionCalls.length === 2);
  assert.equal(installationTokenCalls.length, 2);
  assert.equal(commentCalls.length, 1);
  assert.deepEqual(reactionCalls, [
    "POST https://api.github.com/repos/acme/demo/issues/comments/99/reactions eyes",
    "POST https://api.github.com/repos/acme/demo/issues/comments/99/reactions rocket"
  ]);
  assert.match(commentCalls[0] ?? "", /^POST https:\/\/api\.github\.com\/repos\/acme\/demo\/issues\/7\/comments /);
  assert.match(commentCalls[0] ?? "", /queued this workflow/);
  assert.match(commentCalls[0] ?? "", /Workflow exited with code 17\./);
});

test("GitHub provider adds rocket reactions for successful queued workflows on supported sources", async (t) => {
  const { commentCalls, emitTrackedCompleted, installationTokenCalls, reactionCalls, started, url } =
    await startGitHubApp(t, {
      customizeConfig(config) {
        if (!config.gh) {
          throw new Error("Missing test GitHub config.");
        }

        config.gh.ignoreApprovalReview = false;
      }
    });
  const scenarios = [
    {
      eventName: "issues",
      payload: issueOpenedPayload(),
      runId: "run-1",
      terminalEvent: {
        runId: "run-1",
        workflowName: "issue-plan",
        matchedTrigger: "issue:open" as const,
        executorName: "codex",
        completedAt: "2026-04-02T00:00:10.000Z",
        status: "succeeded" as const
      }
    },
    {
      eventName: "issue_comment",
      payload: issueCommentPayload("looks good", { pullRequest: true }),
      runId: "run-2",
      terminalEvent: {
        runId: "run-2",
        workflowName: "pr-comment",
        matchedTrigger: "pr:comment" as const,
        executorName: "codex",
        completedAt: "2026-04-02T00:00:11.000Z",
        status: "succeeded" as const
      }
    },
    {
      eventName: "pull_request_review_comment",
      payload: reviewCommentPayload("needs work"),
      runId: "run-3",
      terminalEvent: {
        runId: "run-3",
        workflowName: "pr-comment",
        matchedTrigger: "pr:comment" as const,
        executorName: "codex",
        completedAt: "2026-04-02T00:00:12.000Z",
        status: "succeeded" as const
      }
    },
    {
      eventName: "pull_request_review",
      payload: reviewPayload("ship it", "approved"),
      runId: "run-4",
      terminalEvent: {
        runId: "run-4",
        workflowName: "pr-review",
        matchedTrigger: "pr:review" as const,
        executorName: "codex",
        completedAt: "2026-04-02T00:00:13.000Z",
        status: "succeeded" as const
      }
    }
  ];

  for (const scenario of scenarios) {
    const response = await signedRequest(url, scenario.payload, scenario.eventName);
    assert.equal(response.status, 202);
  }

  await waitForCondition(() => started.length === scenarios.length);

  for (const scenario of scenarios) {
    await emitTrackedCompleted(scenario.runId, scenario.terminalEvent);
  }

  await waitForCondition(() => reactionCalls.length === scenarios.length * 2);
  assert.deepEqual(commentCalls, []);
  assert.equal(installationTokenCalls.length, scenarios.length * 2);
  assert.deepEqual(reactionCalls, [
    "POST https://api.github.com/repos/acme/demo/issues/7/reactions eyes",
    "POST https://api.github.com/repos/acme/demo/issues/comments/99/reactions eyes",
    "POST https://api.github.com/repos/acme/demo/pulls/comments/101/reactions eyes",
    "POST https://api.github.com/graphql EYES PRR_kwDOdemo202",
    "POST https://api.github.com/repos/acme/demo/issues/7/reactions rocket",
    "POST https://api.github.com/repos/acme/demo/issues/comments/99/reactions rocket",
    "POST https://api.github.com/repos/acme/demo/pulls/comments/101/reactions rocket",
    "POST https://api.github.com/graphql ROCKET PRR_kwDOdemo202"
  ]);
});

async function startGitHubApp(
  t: TestContext,
  options?: {
    createQueuedRunError?: Error;
    customizeConfig?: (config: AppConfig) => void;
    logSink?: LogSink;
  }
) {
  const config = {
    ...createServiceConfig(),
    server: {
      host: "127.0.0.1",
      port: 0
    }
  };
  options?.customizeConfig?.(config);
  const github = config.gh;

  if (!github) {
    throw new Error("Missing test GitHub config.");
  }
  const env = await createGitHubAppEnv();
  const commands: string[] = [];
  const commentCalls: string[] = [];
  const envs: NodeJS.ProcessEnv[] = [];
  const installationTokenCalls: string[] = [];
  const reactionCalls: string[] = [];
  const started: string[] = [];
  const terminalListeners = new Map<string, AppContextTerminalListeners>();
  let runCount = 0;
  const logSink = options?.logSink ?? createNoOpLogSink();
  const originalFetch = global.fetch;

  global.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    if (url.startsWith("https://api.github.com/app/installations/")) {
      installationTokenCalls.push(url);
      return new Response(JSON.stringify({ token: "installation-token" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    if (url === "https://api.github.com/graphql") {
      const body = JSON.parse(String(init?.body)) as {
        variables?: { content?: string; subjectId?: string };
      };
      reactionCalls.push(
        `${init?.method ?? "GET"} ${url} ${body.variables?.content ?? ""} ${body.variables?.subjectId ?? ""}`.trim()
      );
      return new Response(JSON.stringify({ data: { addReaction: { reaction: { content: body.variables?.content } } } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    if (url.includes("/reactions")) {
      reactionCalls.push(`${init?.method ?? "GET"} ${url} ${JSON.parse(String(init?.body)).content}`);
      return new Response(JSON.stringify({ id: 1, content: "eyes" }), {
        status: 201,
        headers: { "content-type": "application/json" }
      });
    }

    if (/\/issues\/\d+\/comments$/.test(url)) {
      commentCalls.push(`${init?.method ?? "GET"} ${url} ${JSON.parse(String(init?.body)).body}`);
      return new Response(JSON.stringify({ id: 2 }), {
        status: 201,
        headers: { "content-type": "application/json" }
      });
    }

    return originalFetch(input, init);
  };

  const app = await App(config, {
    processRunner: {
      async run() {
        throw new Error("should not run");
      },
      async startDetached(command, options) {
        commands.push(command);
        envs.push(options.env);
        runCount += 1;
        return {
          pid: 1000 + runCount,
          startedAt: "2026-04-02T00:00:00.000Z"
        };
      },
      isProcessRunning() {
        return true;
      },
      async readDetachedResult() {
        return null;
      }
    },
    workspaceRepo: {
      async createRunWorkspace() {
        return "";
      },
      async ensureReusableWorkspace() {
        return "";
      },
      async removeWorkspace() {}
    },
    workflowTracker: {
      async initialize() {},
      async createQueuedRun(context, details) {
        if (options?.createQueuedRunError) {
          throw options.createQueuedRunError;
        }
        return {
          record: createQueuedRunRecord(`run-${runCount + 1}`, {
            ...context,
            workspacePath: details.workspacePath,
            workspaceKey: details.workspaceKey,
            launch: details.launch
          }),
          shouldLaunchNow: true
        };
      },
      async getLaunchableQueuedRuns() {
        return [];
      },
      subscribeTerminalEvents(runId, listeners) {
        terminalListeners.set(runId, {
          completed: [...listeners.completed],
          error: [...listeners.error]
        });
        return () => {
          terminalListeners.delete(runId);
        };
      },
      async updateQueuedRun() {
        return {} as never;
      },
      async getActiveRunCount() {
        return 0;
      },
      async markRunning(_runId: string, details: { command: string }) {
        started.push(details.command);
        return {} as never;
      },
      async markTerminal() {
        throw new Error("should not be called");
      },
      async reconcileActiveRuns() {
        return [];
      }
    },
    logSink,
    baseEnv: {
      ...process.env,
      GITHUB_WEBHOOK_SECRET: "top-secret",
      GITHUB_APP_PRIVATE_KEY_PATH: env.pemPath
    },
    reconcileIntervalMs: 0
  })
    .provider(github.url, githubProvider)
    .listen();

  t.after(async () => {
    global.fetch = originalFetch;
    app.server.close();
    await once(app.server, "close");
    await rm(env.dir, { recursive: true, force: true });
  });

  const address = app.server.address();

  if (!address || typeof address === "string") {
    throw new Error("Unexpected test server address.");
  }

  return {
    server: app.server,
    commands,
    commentCalls,
    emitTrackedCompleted(runId: string, payload: WorkflowCompletedEventPayload) {
      return emitTrackedCompleted(terminalListeners, runId, payload);
    },
    emitTrackedError(runId: string, payload: WorkflowErrorEventPayload) {
      return emitTrackedError(terminalListeners, runId, payload);
    },
    envs,
    installationTokenCalls,
    reactionCalls,
    started,
    url: `http://127.0.0.1:${address.port}${github.url}`
  };
}

async function createGitHubAppEnv() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const dir = await mkdtemp(path.join(tmpdir(), "gao-gh-provider-"));
  const pemPath = path.join(dir, "app.pem");

  await writeFile(pemPath, pem);

  return { dir, pemPath };
}

async function signedRequest(url: string, payload: unknown, eventName: string) {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", "top-secret").update(body).digest("hex");

  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": eventName,
      "x-hub-signature-256": `sha256=${signature}`
    },
    body
  });
}

async function emitTrackedCompleted(
  terminalListeners: Map<string, AppContextTerminalListeners>,
  runId: string,
  payload: WorkflowCompletedEventPayload
): Promise<void> {
  const listeners = terminalListeners.get(runId);
  if (!listeners) {
    throw new Error(`Missing terminal listeners for ${runId}.`);
  }

  for (const listener of listeners.completed) {
    await listener(payload);
  }
}

async function emitTrackedError(
  terminalListeners: Map<string, AppContextTerminalListeners>,
  runId: string,
  payload: WorkflowErrorEventPayload
): Promise<void> {
  const listeners = terminalListeners.get(runId);
  if (!listeners) {
    throw new Error(`Missing terminal listeners for ${runId}.`);
  }

  for (const listener of listeners.error) {
    await listener(payload);
  }
}

async function waitForCondition(check: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (check()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for background workflow launch.");
}

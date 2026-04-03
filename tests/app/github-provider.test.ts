import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { App } from "../../src/app/app.js";
import {
  evaluateGitHubDelivery,
  normalizeGitHubDeliveryPayload
} from "../../src/app/providers/github-delivery-relevance.js";
import { resolveGitHubProviderConfig } from "../../src/app/providers/github-config.js";
import { githubProvider } from "../../src/app/providers/github-provider.js";
import {
  issueCommentPayload,
  issueOpenedPayload,
  reviewCommentPayload,
  reviewPayload
} from "../fixtures/github-webhooks.js";
import { createNoOpLogSink } from "../fixtures/log-sink.js";
import { createServiceConfig } from "../fixtures/service-config.js";
import type { ActiveWorkflowRunRecord, WorkflowRunArtifacts } from "../../src/types/tracking.js";

test("GitHub delivery evaluator keeps non-mentioned issue comments ignored", () => {
  const config = createServiceConfig().gh;

  if (!config) {
    throw new Error("Missing test GitHub config.");
  }

  const evaluation = evaluateGitHubDelivery(
    "issue_comment",
    normalizeGitHubDeliveryPayload(issueCommentPayload("please plan this")),
    resolveGitHubProviderConfig(config)
  );

  assert.deepEqual(evaluation, {
    status: "ignored",
    gate: {
      actorLogin: "octocat",
      installationId: 42,
      repoFullName: "acme/demo"
    },
    reason: "not_mentioned"
  });
});

test("GitHub delivery evaluator preserves command and generic mention routing", () => {
  const config = createServiceConfig().gh;

  if (!config) {
    throw new Error("Missing test GitHub config.");
  }

  const evaluation = evaluateGitHubDelivery(
    "issue_comment",
    normalizeGitHubDeliveryPayload(issueCommentPayload("@github-agent-orchestrator /approve")),
    resolveGitHubProviderConfig(config)
  );

  assert.equal(evaluation.status, "relevant");
  assert.deepEqual(evaluation.delivery.triggers.map((trigger) => trigger.name), [
    "issue:command:approve",
    "issue:comment"
  ]);
  assert.deepEqual(evaluation.delivery.reactionTarget, {
    subjectId: 99,
    kind: "issue_comment"
  });
});

function createQueuedRunRecord(runId: string): ActiveWorkflowRunRecord {
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
    artifacts
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

test("GitHub provider treats removed issue command aliases as generic mentions", async (t) => {
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

async function startGitHubApp(
  t: TestContext,
  options?: { createQueuedRunError?: Error }
) {
  const config = {
    ...createServiceConfig(),
    server: {
      host: "127.0.0.1",
      port: 0
    }
  };
  const github = config.gh;

  if (!github) {
    throw new Error("Missing test GitHub config.");
  }
  const env = await createGitHubAppEnv();
  const commands: string[] = [];
  const commentCalls: string[] = [];
  const envs: NodeJS.ProcessEnv[] = [];
  const reactionCalls: string[] = [];
  const started: string[] = [];
  let runCount = 0;
  const logSink = createNoOpLogSink();
  const originalFetch = global.fetch;

  global.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    if (url.startsWith("https://api.github.com/app/installations/")) {
      return new Response(JSON.stringify({ token: "installation-token" }), {
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

  const server = await App(config, {
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
      async removeWorkspace() {}
    },
    workflowTracker: {
      async initialize() {},
      async createQueuedRun() {
        if (options?.createQueuedRunError) {
          throw options.createQueuedRunError;
        }
        return createQueuedRunRecord(`run-${runCount + 1}`);
      },
      async updateQueuedRun() {
        return {} as never;
      },
      async markRunning(_runId: string, details: { command: string }) {
        started.push(details.command);
        return {} as never;
      },
      async markTerminal() {
        throw new Error("should not be called");
      },
      async reconcileActiveRuns() {}
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
    server.close();
    await once(server, "close");
    await rm(env.dir, { recursive: true, force: true });
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Unexpected test server address.");
  }

  return {
    server,
    commands,
    commentCalls,
    envs,
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

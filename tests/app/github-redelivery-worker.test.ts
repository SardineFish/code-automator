import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { resolveGitHubProviderConfig } from "../../src/app/providers/github-config.js";
import type {
  GitHubAppWebhookDelivery,
  GitHubAppWebhookDeliveryDetail
} from "../../src/app/providers/github-redelivery-client.js";
import {
  createGitHubRedeliveryWorker,
  selectGitHubRedeliveryCandidates
} from "../../src/app/providers/github-redelivery-worker.js";
import { createMemoryLogSink, createNoOpLogSink, type CapturedLogRecord } from "../fixtures/log-sink.js";
import type { LogSink } from "../../src/types/logging.js";
import { createServiceConfig } from "../fixtures/service-config.js";
import type { AppConfig } from "../../src/types/config.js";

const FIXED_NOW = new Date("2026-04-02T12:00:00.000Z");

test("selectGitHubRedeliveryCandidates dedupes by guid and skips successful, recent, and settled deliveries", () => {
  const deliveries: GitHubAppWebhookDelivery[] = [
    {
      id: "10",
      guid: "guid-retry",
      deliveredAt: "2026-04-02T11:40:00.000Z",
      redelivery: false,
      status: "FAILED",
      statusCode: 500
    },
    {
      id: "11",
      guid: "guid-retry",
      deliveredAt: "2026-04-02T11:45:00.000Z",
      redelivery: true,
      status: "FAILED",
      statusCode: 500
    },
    {
      id: "20",
      guid: "guid-ok",
      deliveredAt: "2026-04-02T11:30:00.000Z",
      redelivery: false,
      status: "FAILED",
      statusCode: 500
    },
    {
      id: "21",
      guid: "guid-ok",
      deliveredAt: "2026-04-02T11:35:00.000Z",
      redelivery: true,
      status: "OK",
      statusCode: 200
    },
    {
      id: "30",
      guid: "guid-recent",
      deliveredAt: "2026-04-02T11:59:45.000Z",
      redelivery: false,
      status: "FAILED",
      statusCode: 500
    }
  ];

  const candidates = selectGitHubRedeliveryCandidates(
    deliveries,
    { "guid-already-settled": "2026-04-02T11:50:00.000Z" },
    FIXED_NOW,
    2
  );

  assert.deepEqual(candidates.map((delivery) => delivery.id), ["11"]);
});

test("createGitHubRedeliveryWorker skips deliveries rejected by the provider filter", async (t) => {
  const harness = await createWorkerHarness(t, {
    detail: createIssueCommentDetail("@github-agent-orchestrator /approve", { senderLogin: "intruder" })
  });

  await createGitHubRedeliveryWorker(harness.options).runOnce();

  assert.deepEqual(harness.redeliveryCalls, []);
});

test("createGitHubRedeliveryWorker retries plain issue comments when requireMention is false", async (t) => {
  const harness = await createWorkerHarness(t, {
    detail: createIssueCommentDetail("please plan this"),
    customizeConfig(config) {
      if (!config.gh) {
        throw new Error("Missing test GitHub config.");
      }

      config.gh.requireMention = false;
    }
  });

  await createGitHubRedeliveryWorker(harness.options).runOnce();

  assert.deepEqual(harness.redeliveryCalls, ["11"]);
});

test("createGitHubRedeliveryWorker skips ignored issue comments without a mention", async (t) => {
  const harness = await createWorkerHarness(t, {
    detail: createIssueCommentDetail("please plan this")
  });

  await createGitHubRedeliveryWorker(harness.options).runOnce();

  assert.deepEqual(harness.redeliveryCalls, []);
});

test("createGitHubRedeliveryWorker skips approved reviews when ignoreApprovalReview is enabled", async (t) => {
  const harness = await createWorkerHarness(t, {
    detail: createReviewDetail("ship it", "approved")
  });

  await createGitHubRedeliveryWorker(harness.options).runOnce();

  assert.deepEqual(harness.redeliveryCalls, []);
});

test("createGitHubRedeliveryWorker retries approved reviews when ignoreApprovalReview is disabled", async (t) => {
  const harness = await createWorkerHarness(t, {
    detail: createReviewDetail("ship it", "approved"),
    customizeConfig(config) {
      if (!config.gh) {
        throw new Error("Missing test GitHub config.");
      }

      config.gh.ignoreApprovalReview = false;
    }
  });

  await createGitHubRedeliveryWorker(harness.options).runOnce();

  assert.deepEqual(harness.redeliveryCalls, ["11"]);
});

test("createGitHubRedeliveryWorker skips already closed issues", async (t) => {
  const issueHarness = await createWorkerHarness(t, {
    detail: createIssueOpenedDetail(),
    issueState: "closed"
  });

  await createGitHubRedeliveryWorker(issueHarness.options).runOnce();

  assert.deepEqual(issueHarness.redeliveryCalls, []);
});

test("createGitHubRedeliveryWorker skips already closed pull requests", async (t) => {
  const harness = await createWorkerHarness(t, {
    detail: createReviewCommentDetail("needs work"),
    pullRequestState: "closed"
  });

  await createGitHubRedeliveryWorker(harness.options).runOnce();

  assert.deepEqual(harness.redeliveryCalls, []);
});

test("createGitHubRedeliveryWorker skips issue comments that already have the bot eyes reaction", async (t) => {
  const harness = await createWorkerHarness(t, {
    detail: createIssueCommentDetail("@github-agent-orchestrator /approve"),
    reactions: [{ content: "eyes", user: { login: "github-agent-orchestrator[bot]", type: "Bot" } }]
  });

  await createGitHubRedeliveryWorker(harness.options).runOnce();

  assert.deepEqual(harness.redeliveryCalls, []);
});

test("createGitHubRedeliveryWorker skips issue openings that already have the bot eyes reaction", async (t) => {
  const harness = await createWorkerHarness(t, {
    detail: createIssueOpenedDetail(),
    reactions: [{ content: "eyes", user: { login: "github-agent-orchestrator[bot]", type: "Bot" } }]
  });

  await createGitHubRedeliveryWorker(harness.options).runOnce();

  assert.deepEqual(harness.redeliveryCalls, []);
});

test("createGitHubRedeliveryWorker skips PR review comments that already have the bot eyes reaction", async (t) => {
  const harness = await createWorkerHarness(t, {
    detail: createReviewCommentDetail("needs work"),
    reactions: [{ content: "eyes", user: { login: "github-agent-orchestrator[bot]", type: "Bot" } }]
  });

  await createGitHubRedeliveryWorker(harness.options).runOnce();

  assert.deepEqual(harness.redeliveryCalls, []);
});

test("createGitHubRedeliveryWorker retries relevant unhandled failures even when another user already reacted", async (t) => {
  const harness = await createWorkerHarness(t, {
    detail: createIssueCommentDetail("@github-agent-orchestrator /approve"),
    reactions: [{ content: "eyes", user: { login: "octocat", type: "User" } }]
  });

  await createGitHubRedeliveryWorker(harness.options).runOnce();

  assert.deepEqual(harness.redeliveryCalls, ["11"]);
});

test("createGitHubRedeliveryWorker only logs successful retries at info", async (t) => {
  const records: CapturedLogRecord[] = [];
  const harness = await createWorkerHarness(t, {
    detail: createIssueCommentDetail("@github-agent-orchestrator /approve"),
    logSink: createMemoryLogSink(records)
  });

  await createGitHubRedeliveryWorker(harness.options).runOnce();

  assert.deepEqual(harness.redeliveryCalls, ["11"]);
  assert.deepEqual(
    records.filter((record) => record.level === "info").map((record) => record.message),
    ["retried GitHub App webhook delivery"]
  );
  assert.ok(
    records.some(
      (record) => record.level === "debug" && record.message === "scanned GitHub App webhook deliveries"
    )
  );
  assert.ok(
    records.some(
      (record) => record.level === "debug" && record.message === "completed GitHub App webhook delivery scan"
    )
  );
});

test("createGitHubRedeliveryWorker logs skip paths at debug", async (t) => {
  const records: CapturedLogRecord[] = [];
  const harness = await createWorkerHarness(t, {
    detail: createIssueCommentDetail("@github-agent-orchestrator /approve", { senderLogin: "intruder" }),
    logSink: createMemoryLogSink(records)
  });

  await createGitHubRedeliveryWorker(harness.options).runOnce();

  assert.deepEqual(harness.redeliveryCalls, []);
  assert.ok(
    records.some(
      (record) =>
        record.level === "debug" && record.message === "skipped GitHub App webhook delivery by provider filter"
    )
  );
  assert.equal(
    records.some(
      (record) =>
        record.level === "info" && record.message === "skipped GitHub App webhook delivery by provider filter"
    ),
    false
  );
});

test("createGitHubRedeliveryWorker keeps candidate failures at warn", async (t) => {
  const records: CapturedLogRecord[] = [];
  const harness = await createWorkerHarness(t, {
    detail: createIssueCommentDetail("@github-agent-orchestrator /approve"),
    getDeliveryError: new Error("detail failed"),
    logSink: createMemoryLogSink(records)
  });

  await createGitHubRedeliveryWorker(harness.options).runOnce();

  assert.deepEqual(harness.redeliveryCalls, []);
  assert.ok(
    records.some(
      (record) =>
        record.level === "warn" &&
        record.message === "GitHub App webhook redelivery candidate handling failed" &&
        record.errorMessage === "detail failed"
    )
  );
});

test("createGitHubRedeliveryWorker persists settled GUIDs across restarts", async (t) => {
  const harness = await createWorkerHarness(t, {
    detail: createIssueCommentDetail("@github-agent-orchestrator /approve")
  });

  await createGitHubRedeliveryWorker(harness.options).runOnce();
  await createGitHubRedeliveryWorker(harness.options).runOnce();

  assert.deepEqual(harness.redeliveryCalls, ["11"]);
});

test("createGitHubRedeliveryWorker start waits until the first interval before scanning", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "gao-gh-redelivery-start-"));
  const env = await createGitHubAppEnv(dir);
  const config = createServiceConfig();
  const trackingDir = path.join(dir, "tracking");
  let listCalls = 0;

  config.tracking = {
    stateFile: path.join(trackingDir, "state.json"),
    logFile: path.join(trackingDir, "runs.jsonl")
  };
  if (!config.gh) {
    throw new Error("Missing test GitHub config.");
  }
  config.gh = {
    ...config.gh,
    redelivery: {
      intervalSeconds: 1,
      maxPerRun: 5
    }
  };

  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const worker = createGitHubRedeliveryWorker({
    github: resolveGitHubProviderConfig(config.gh),
    tracking: config.tracking,
    env: {
      ...process.env,
      GITHUB_APP_PRIVATE_KEY_PATH: env.pemPath
    },
    logSink: createNoOpLogSink(),
    client: {
      async listDeliveries() {
        listCalls += 1;
        return {
          deliveries: [],
          nextPageUrl: undefined
        };
      },
      async getDelivery() {
        throw new Error("should not be called");
      },
      async redeliverDelivery() {}
    }
  });

  worker.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(listCalls, 0);

  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(listCalls, 1);

  await worker.stop();
});

function createIssueOpenedDetail(): GitHubAppWebhookDeliveryDetail {
  return {
    ...createDeliverySummary("11", "guid-retry"),
    eventName: "issues",
    payload: {
      action: "opened",
      repository: { full_name: "acme/demo" },
      sender: { login: "octocat" },
      installation: { id: 42 },
      issue: {
        number: 7,
        body: "Need a plan"
      }
    }
  };
}

function createIssueCommentDetail(
  body: string,
  options?: { pullRequest?: boolean; senderLogin?: string }
): GitHubAppWebhookDeliveryDetail {
  return {
    ...createDeliverySummary("11", "guid-retry"),
    eventName: "issue_comment",
    payload: {
      action: "created",
      repository: { full_name: "acme/demo" },
      sender: { login: options?.senderLogin ?? "octocat" },
      installation: { id: 42 },
      issue: {
        number: 7,
        body: "Need a plan",
        ...(options?.pullRequest
          ? { pull_request: { url: "https://api.github.com/repos/acme/demo/pulls/7" } }
          : {})
      },
      comment: {
        body,
        id: 99
      }
    }
  };
}

function createReviewCommentDetail(body: string): GitHubAppWebhookDeliveryDetail {
  return {
    ...createDeliverySummary("11", "guid-retry"),
    eventName: "pull_request_review_comment",
    payload: {
      action: "created",
      repository: { full_name: "acme/demo" },
      sender: { login: "octocat" },
      installation: { id: 42 },
      pull_request: {
        number: 8
      },
      comment: {
        body,
        id: 101
      }
    }
  };
}

function createReviewDetail(body: string, state: string): GitHubAppWebhookDeliveryDetail {
  return {
    ...createDeliverySummary("11", "guid-retry"),
    eventName: "pull_request_review",
    payload: {
      action: "submitted",
      repository: { full_name: "acme/demo" },
      sender: { login: "octocat" },
      installation: { id: 42 },
      pull_request: {
        number: 8
      },
      review: {
        id: 202,
        node_id: "PRR_kwDOdemo202",
        body,
        state
      }
    }
  };
}

function createDeliverySummary(id: string, guid: string): GitHubAppWebhookDelivery {
  return {
    id,
    guid,
    deliveredAt: "2026-04-02T11:45:00.000Z",
    redelivery: true,
    status: "FAILED",
    statusCode: 500
  };
}

async function createWorkerHarness(
  t: TestContext,
  options: {
    detail: GitHubAppWebhookDeliveryDetail;
    customizeConfig?: (config: AppConfig) => void;
    getDeliveryError?: Error;
    issueState?: string;
    logSink?: LogSink;
    pullRequestState?: string;
    reactions?: unknown[];
  }
) {
  const dir = await mkdtemp(path.join(tmpdir(), "gao-gh-redelivery-"));
  const env = await createGitHubAppEnv(dir);
  const config = createServiceConfig();
  const trackingDir = path.join(dir, "tracking");
  options.customizeConfig?.(config);
  const githubConfig = config.gh;
  const redeliveryCalls: string[] = [];
  const originalFetch = global.fetch;
  const logSink = options.logSink ?? createNoOpLogSink();

  config.tracking = {
    stateFile: path.join(trackingDir, "state.json"),
    logFile: path.join(trackingDir, "runs.jsonl")
  };
  if (!githubConfig) {
    throw new Error("Missing test GitHub config.");
  }
  config.gh = {
    ...githubConfig,
    redelivery: {
      intervalSeconds: 300,
      maxPerRun: 5
    }
  };

  global.fetch = async (input) => {
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

    if (
      /\/issues\/\d+\/reactions\?per_page=100$/.test(url) ||
      /\/issues\/comments\/\d+\/reactions\?per_page=100$/.test(url) ||
      /\/pulls\/comments\/\d+\/reactions\?per_page=100$/.test(url)
    ) {
      return new Response(JSON.stringify(options.reactions ?? []), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    if (/\/issues\/\d+$/.test(url)) {
      return new Response(JSON.stringify({ state: options.issueState ?? "open" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    if (/\/pulls\/\d+$/.test(url)) {
      return new Response(JSON.stringify({ state: options.pullRequestState ?? "open" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  t.after(async () => {
    global.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  });

  const github = resolveGitHubProviderConfig(config.gh);
  const client = {
    async listDeliveries() {
      return {
        deliveries: [{ ...options.detail }],
        nextPageUrl: undefined
      };
    },
    async getDelivery() {
      if (options.getDeliveryError) {
        throw options.getDeliveryError;
      }

      return options.detail;
    },
    async redeliverDelivery(_jwt: string, deliveryId: string) {
      redeliveryCalls.push(deliveryId);
    }
  };

  return {
    options: {
      github,
      tracking: config.tracking,
      env: {
        ...process.env,
        GITHUB_APP_PRIVATE_KEY_PATH: env.pemPath
      },
      logSink,
      client,
      now: () => FIXED_NOW
    },
    redeliveryCalls
  };
}

test("createGitHubRedeliveryWorker stop waits for an in-flight scan and cancels future intervals", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "gao-gh-redelivery-stop-"));
  const env = await createGitHubAppEnv(dir);
  const config = createServiceConfig();
  const trackingDir = path.join(dir, "tracking");
  const started = createDeferred<void>();
  const release = createDeferred<void>();
  let listCalls = 0;

  config.tracking = {
    stateFile: path.join(trackingDir, "state.json"),
    logFile: path.join(trackingDir, "runs.jsonl")
  };
  if (!config.gh) {
    throw new Error("Missing test GitHub config.");
  }
  config.gh = {
    ...config.gh,
    redelivery: {
      intervalSeconds: 1,
      maxPerRun: 5
    }
  };

  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const worker = createGitHubRedeliveryWorker({
    github: resolveGitHubProviderConfig(config.gh),
    tracking: config.tracking,
    env: {
      ...process.env,
      GITHUB_APP_PRIVATE_KEY_PATH: env.pemPath
    },
    logSink: createNoOpLogSink(),
    client: {
      async listDeliveries() {
        listCalls += 1;
        started.resolve();
        await release.promise;
        return {
          deliveries: [],
          nextPageUrl: undefined
        };
      },
      async getDelivery() {
        throw new Error("should not be called");
      },
      async redeliverDelivery() {}
    }
  });

  worker.start();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await started.promise;

  let stopResolved = false;
  const stopPromise = worker.stop().then(() => {
    stopResolved = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(stopResolved, false);

  release.resolve();
  await stopPromise;
  await new Promise((resolve) => setTimeout(resolve, 1100));

  assert.equal(listCalls, 1);
});

async function createGitHubAppEnv(dir: string) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const pemPath = path.join(dir, "app.pem");

  await writeFile(pemPath, pem);

  return { pemPath };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

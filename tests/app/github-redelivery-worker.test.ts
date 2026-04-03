import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveGitHubProviderConfig } from "../../src/app/providers/github-config.js";
import type { GitHubAppWebhookDelivery } from "../../src/app/providers/github-redelivery-client.js";
import { createGitHubRedeliveryWorker, selectGitHubRedeliveryCandidates } from "../../src/app/providers/github-redelivery-worker.js";
import { createNoOpLogSink } from "../fixtures/log-sink.js";
import { createServiceConfig } from "../fixtures/service-config.js";

test("selectGitHubRedeliveryCandidates dedupes by guid and skips successful or recent deliveries", () => {
  const deliveries: GitHubAppWebhookDelivery[] = [
    {
      id: 10,
      guid: "guid-retry",
      deliveredAt: "2026-04-02T11:40:00.000Z",
      redelivery: false,
      status: "FAILED",
      statusCode: 500
    },
    {
      id: 11,
      guid: "guid-retry",
      deliveredAt: "2026-04-02T11:45:00.000Z",
      redelivery: true,
      status: "FAILED",
      statusCode: 500
    },
    {
      id: 20,
      guid: "guid-ok",
      deliveredAt: "2026-04-02T11:30:00.000Z",
      redelivery: false,
      status: "FAILED",
      statusCode: 500
    },
    {
      id: 21,
      guid: "guid-ok",
      deliveredAt: "2026-04-02T11:35:00.000Z",
      redelivery: true,
      status: "OK",
      statusCode: 200
    },
    {
      id: 30,
      guid: "guid-recent",
      deliveredAt: "2026-04-02T11:59:45.000Z",
      redelivery: false,
      status: "FAILED",
      statusCode: 500
    }
  ];

  const candidates = selectGitHubRedeliveryCandidates(
    deliveries,
    { "guid-already-tried": "2026-04-02T11:50:00.000Z" },
    new Date("2026-04-02T12:00:00.000Z"),
    2
  );

  assert.deepEqual(candidates.map((delivery) => delivery.id), [11]);
});

test("createGitHubRedeliveryWorker persists retried guids across restarts", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "gao-gh-redelivery-"));
  const env = await createGitHubAppEnv(dir);
  const config = createServiceConfig();
  const trackingDir = path.join(dir, "tracking");
  const githubConfig = config.gh;
  const deliveries: GitHubAppWebhookDelivery[] = [
    {
      id: 11,
      guid: "guid-retry",
      deliveredAt: "2026-04-02T11:45:00.000Z",
      redelivery: true,
      status: "FAILED",
      statusCode: 500
    }
  ];
  const redeliveryCalls: number[] = [];

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

  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const github = resolveGitHubProviderConfig(config.gh);
  const client = {
    async listDeliveries() {
      return {
        deliveries,
        nextPageUrl: undefined
      };
    },
    async redeliverDelivery(_jwt: string, deliveryId: number) {
      redeliveryCalls.push(deliveryId);
    }
  };
  const options = {
    github,
    tracking: config.tracking,
    env: {
      ...process.env,
      GITHUB_APP_PRIVATE_KEY_PATH: env.pemPath
    },
    logSink: createNoOpLogSink(),
    client,
    now: () => new Date("2026-04-02T12:00:00.000Z")
  };

  await createGitHubRedeliveryWorker(options).runOnce();
  await createGitHubRedeliveryWorker(options).runOnce();

  assert.deepEqual(redeliveryCalls, [11]);
});

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
      async redeliverDelivery() {}
    }
  });

  worker.start();
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

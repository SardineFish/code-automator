import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { App, type ProviderHandler } from "../../../src/app/app.js";
import { createServiceConfig } from "../../fixtures/service-config.js";
import { createNoOpLogSink } from "../../fixtures/log-sink.js";

test("App dispatches exact provider routes and lets providers own the response", async () => {
  const { server, url } = await startApp((request, response) => {
    assert.equal(new URL(request.url ?? "/", "http://127.0.0.1").pathname, "/chat");
    response.statusCode = 204;
    response.end();
  });

  const result = await fetch(url, { method: "POST" });

  assert.equal(result.status, 204);
  server.close();
  await once(server, "close");
});

test("App rejects duplicate provider routes", () => {
  const builder = App(createAppConfig(), createRuntimeOptions());
  builder.provider("/chat", (_request, response) => {
    response.end("ok");
  });

  assert.throws(
    () =>
      builder.provider("/chat", (_request, response) => {
        response.end("duplicate");
      }),
    /already registered/
  );
});

test("App returns 500 when a provider throws", async () => {
  const { server, url } = await startApp(() => {
    throw new Error("boom");
  });

  const result = await fetch(url, { method: "POST" });

  assert.equal(result.status, 500);
  server.close();
  await once(server, "close");
});

test("App returns 500 when a provider submits duplicate trigger names", async () => {
  const { server, url } = await startApp((_request, _response, context) => {
    context.trigger("issue:comment", { in: { content: "hello" } });
    context.trigger("issue:comment", { in: { content: "again" } });
  });

  const result = await fetch(url, { method: "POST" });

  assert.equal(result.status, 500);
  server.close();
  await once(server, "close");
});

test("App stopAcceptingRequests drains started requests before waitForIdleRequests resolves", async () => {
  const started = createDeferred<void>();
  const release = createDeferred<void>();
  const { server, stopAcceptingRequests, waitForIdleRequests, url } = await startApp(
    async (_request, response) => {
      started.resolve();
      await release.promise;
      response.statusCode = 204;
      response.end();
    }
  );

  const activeRequest = fetch(url, { method: "POST" });

  await started.promise;
  await stopAcceptingRequests();
  const serverClosed = once(server, "close");

  let idleResolved = false;
  const idlePromise = waitForIdleRequests().then(() => {
    idleResolved = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(idleResolved, false);

  const secondRequest = await tryFetch(url);
  assert.ok(secondRequest.kind === "error" || secondRequest.status === 503);

  release.resolve();

  const result = await activeRequest;
  assert.equal(result.status, 204);
  await idlePromise;
  await serverClosed;
});

async function startApp(
  handler: ProviderHandler
) {
  const app = await App(createAppConfig(), createRuntimeOptions())
    .provider("/chat", handler)
    .listen();
  const address = app.server.address();

  if (!address || typeof address === "string") {
    throw new Error("Unexpected test server address.");
  }

  return {
    server: app.server,
    stopAcceptingRequests: () => app.stopAcceptingRequests(),
    waitForIdleRequests: () => app.waitForIdleRequests(),
    url: `http://127.0.0.1:${address.port}/chat`
  };
}

function createAppConfig() {
  return {
    ...createServiceConfig(),
    server: {
      host: "127.0.0.1",
      port: 0
    }
  };
}

function createRuntimeOptions() {
  return {
    processRunner: {
      async run() {
        throw new Error("should not run");
      },
      async startDetached() {
        throw new Error("should not run");
      },
      isProcessRunning() {
        return false;
      },
      async readDetachedResult() {
        return null;
      }
    },
    workspaceRepo: {
      async createRunWorkspace() {
        throw new Error("should not run");
      },
      async ensureReusableWorkspace() {
        throw new Error("should not run");
      },
      async removeWorkspace() {}
    },
    workflowTracker: {
      async initialize() {},
      async createQueuedRun() {
        throw new Error("should not run");
      },
      async getLaunchableQueuedRuns() {
        return [];
      },
      subscribeTerminalEvents() {
        return () => undefined;
      },
      async updateQueuedRun() {
        throw new Error("should not run");
      },
      async getActiveRunCount() {
        return 0;
      },
      async markRunning() {
        throw new Error("should not run");
      },
      async markTerminal() {
        throw new Error("should not run");
      },
      async reconcileActiveRuns() {
        return [];
      }
    },
    logSink: createNoOpLogSink(),
    reconcileIntervalMs: 0
  };
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

async function tryFetch(url: string) {
  try {
    const response = await fetch(url, { method: "POST" });
    return { kind: "response" as const, status: response.status };
  } catch (error) {
    return { kind: "error" as const, error };
  }
}

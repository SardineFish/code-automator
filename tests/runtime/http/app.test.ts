import type { IncomingMessage, ServerResponse } from "node:http";
import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { App, type ProviderHandler } from "../../../src/app/app.js";
import { createServiceConfig } from "../../fixtures/service-config.js";
import { createNoOpLogSink } from "../../fixtures/log-sink.js";

test("App dispatches exact provider routes and lets providers own the response", async () => {
  const { shutdown, url } = await startApp(async (_context, request, response) => {
    assert.equal(new URL(request.url ?? "/", "http://127.0.0.1").pathname, "/chat");
    response.statusCode = 204;
    response.end();
  });

  const result = await fetch(url, { method: "POST" });

  assert.equal(result.status, 204);
  await shutdown();
});

test("App rejects duplicate provider keys", () => {
  const builder = App(createAppConfig(), createRuntimeOptions());
  builder.provider<[IncomingMessage, ServerResponse], void>(
    "/chat",
    async (_context, _request, response) => {
      response.end("ok");
    }
  );

  assert.throws(
    () =>
      builder.provider<[IncomingMessage, ServerResponse], void>(
        "/chat",
        async (_context, _request, response) => {
          response.end("duplicate");
        }
      ),
    /already registered/
  );
});

test("App starts registered services and runs their shutdown handlers", async () => {
  const events: string[] = [];
  const app = await App(createAppConfig(), createRuntimeOptions())
    .provider<[IncomingMessage, ServerResponse], void>(
      "/chat",
      async (_context, _request, response) => {
        response.statusCode = 204;
        response.end();
      }
    )
    .service(async (appContext) => {
      events.push("start");
      appContext.on("shutdown", async () => {
        events.push("shutdown");
      });
    })
    .listen();

  await app.shutdown();

  assert.deepEqual(events, ["start", "shutdown"]);
});

test("App shutdown waits for tracked app jobs before resolving", async () => {
  const release = createDeferred<void>();
  const app = await App(createAppConfig(), createRuntimeOptions())
    .provider<[IncomingMessage, ServerResponse], void>(
      "/chat",
      async (_context, _request, response) => {
        response.statusCode = 204;
        response.end();
      }
    )
    .service(async (appContext) => {
      appContext.trackJob("startup-job", release.promise);
    })
    .listen();

  let shutdownResolved = false;
  const shutdownPromise = app.shutdown().then(() => {
    shutdownResolved = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(shutdownResolved, false);

  release.resolve();
  await shutdownPromise;
  assert.equal(shutdownResolved, true);
});


test("App returns 500 when a provider throws", async () => {
  const { shutdown, url } = await startApp(async () => {
    throw new Error("boom");
  });

  const result = await fetch(url, { method: "POST" });

  assert.equal(result.status, 500);
  await shutdown();
});

test("App returns 500 when a provider submits duplicate trigger names", async () => {
  const { shutdown, url } = await startApp(async (context) => {
    context.trigger("issue:comment", { in: { content: "hello" } });
    context.trigger("issue:comment", { in: { content: "again" } });
  });

  const result = await fetch(url, { method: "POST" });

  assert.equal(result.status, 500);
  await shutdown();
});

test("App shutdown drains started requests before resolving", async () => {
  const started = createDeferred<void>();
  const release = createDeferred<void>();
  const { server, shutdown, url } = await startApp(
    async (_context, _request, response) => {
      started.resolve();
      await release.promise;
      response.statusCode = 204;
      response.end();
    }
  );

  const activeRequest = fetch(url, { method: "POST" });

  await started.promise;
  let shutdownResolved = false;
  const shutdownPromise = shutdown().then(() => {
    shutdownResolved = true;
  });
  const serverClosed = once(server, "close");

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(shutdownResolved, false);

  const secondRequest = await tryFetch(url);
  assert.ok(secondRequest.kind === "error" || secondRequest.status === 503);

  release.resolve();

  const result = await activeRequest;
  assert.equal(result.status, 204);
  await shutdownPromise;
  await serverClosed;
});

test("App returns 404 for unknown provider paths", async () => {
  const { shutdown, url } = await startApp(async (_context, _request, response) => {
    response.statusCode = 204;
    response.end();
  });

  const result = await fetch(url.replace("/chat", "/missing"), { method: "POST" });

  assert.equal(result.status, 404);
  await shutdown();
});

async function startApp(
  handler: ProviderHandler<[IncomingMessage, ServerResponse], void>
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
    shutdown: () => app.shutdown(),
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

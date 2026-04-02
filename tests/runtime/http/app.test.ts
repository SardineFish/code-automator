import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { App } from "../../../src/app/app.js";
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
  const builder = App.listen("127.0.0.1", 0, createRuntimeOptions());
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

async function startApp(
  handler: Parameters<ReturnType<typeof App.listen>["provider"]>[1]
) {
  const server = await App.listen("127.0.0.1", 0, createRuntimeOptions())
    .provider("/chat", handler)
    .listen();
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Unexpected test server address.");
  }

  return {
    server,
    url: `http://127.0.0.1:${address.port}/chat`
  };
}

function createRuntimeOptions() {
  return {
    config: createServiceConfig(),
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
      async removeWorkspace() {}
    },
    workflowTracker: {
      async initialize() {},
      async createQueuedRun() {
        throw new Error("should not run");
      },
      async updateQueuedRun() {
        throw new Error("should not run");
      },
      async markRunning() {
        throw new Error("should not run");
      },
      async markTerminal() {
        throw new Error("should not run");
      },
      async reconcileActiveRuns() {}
    },
    logSink: createNoOpLogSink()
  };
}

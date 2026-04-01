import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import test from "node:test";

import { createWebhookServer } from "../../../src/runtime/http/create-webhook-server.js";
import { issueCommentPayload } from "../../fixtures/github-webhooks.js";
import { createServiceConfig } from "../../fixtures/service-config.js";

test("createWebhookServer rejects invalid signatures", async () => {
  const { server, url } = await startTestServer();
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
  server.close();
  await once(server, "close");
});

test("createWebhookServer rejects unsupported methods", async () => {
  const { server, url } = await startTestServer();
  const response = await fetch(url, { method: "GET" });

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
  server.close();
  await once(server, "close");
});

test("createWebhookServer accepts webhook URLs with query strings", async () => {
  let called = false;
  const { server, url } = await startTestServer({
    onDelivery: async () => {
      called = true;
      return { status: "matched", reason: "executed" };
    }
  });
  const response = await signedRequest(
    `${url}?source=test`,
    issueCommentPayload("@github-agent-orchestrator /plan"),
    "issue_comment"
  );

  assert.equal(response.status, 202);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(called, true);
  server.close();
  await once(server, "close");
});

test("createWebhookServer ignores whitelist rejections without dispatching", async () => {
  const payload = issueCommentPayload("@github-agent-orchestrator /plan", { senderLogin: "intruder" });
  const dispatched: string[] = [];
  const { logs, server, url } = await startTestServer({
    onDelivery: async () => {
      dispatched.push("called");
      return { status: "matched", reason: "executed" };
    }
  });

  const response = await signedRequest(url, payload, "issue_comment");

  assert.equal(response.status, 202);
  assert.deepEqual(dispatched, []);
  assert.equal(logs[0]?.reason, "actor_not_whitelisted");
  server.close();
  await once(server, "close");
});

test("createWebhookServer ignores deliveries without installation context", async () => {
  const payload = issueCommentPayload("@github-agent-orchestrator /plan");
  delete (payload as { installation?: unknown }).installation;
  const dispatched: string[] = [];
  const { logs, server, url } = await startTestServer({
    onDelivery: async () => {
      dispatched.push("called");
      return { status: "matched", reason: "executed" };
    }
  });

  const response = await signedRequest(url, payload, "issue_comment");

  assert.equal(response.status, 202);
  assert.deepEqual(dispatched, []);
  assert.equal(logs[0]?.reason, "missing_gate_context");
  server.close();
  await once(server, "close");
});

test("createWebhookServer rejects oversized payloads", async () => {
  const { server, url } = await startTestServer();
  const body = "x".repeat((1024 * 1024) + 1);
  const signature = createHmac("sha256", "top-secret").update(body).digest("hex");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "issue_comment",
      "x-hub-signature-256": `sha256=${signature}`
    },
    body
  });

  assert.equal(response.status, 413);
  server.close();
  await once(server, "close");
});

test("createWebhookServer accepts valid deliveries and dispatches asynchronously", async () => {
  let deliveredEventName = "";
  let resolveDelivery = () => {};
  const awaited = new Promise<void>((resolve) => {
    resolveDelivery = resolve;
  });
  const { server, url } = await startTestServer({
    onDelivery: async (delivery) => {
      deliveredEventName = delivery.eventName;
      resolveDelivery();
      return { status: "matched", reason: "executed" };
    }
  });

  const response = await signedRequest(
    url,
    issueCommentPayload("@github-agent-orchestrator /plan"),
    "issue_comment"
  );

  assert.equal(response.status, 202);
  await awaited;
  assert.equal(deliveredEventName, "issue_comment");
  server.close();
  await once(server, "close");
});

async function startTestServer(
  overrides?: Partial<Parameters<typeof createWebhookServer>[0]>
) {
  const logs: Array<Record<string, unknown>> = [];
  const server = createWebhookServer({
    config: createServiceConfig(),
    webhookSecret: "top-secret",
    logSink: {
      info(record) {
        logs.push(record);
      },
      error(record) {
        logs.push(record);
      }
    },
    onDelivery: async () => ({ status: "matched", reason: "executed" }),
    ...overrides
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Unexpected test server address.");
  }

  return {
    server,
    logs,
    url: `http://127.0.0.1:${address.port}${createServiceConfig().server.webhookPath}`
  };
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

import assert from "node:assert/strict";
import test from "node:test";

import { fetchGitHubAppWebhookDeliveryClient } from "../../src/app/providers/github-redelivery-client.js";

test("fetchGitHubAppWebhookDeliveryClient normalizes delivery list pages and detail payloads", async (t) => {
  const originalFetch = global.fetch;
  const calls: Array<{ method: string; url: string; authorization?: string }> = [];

  global.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const headers = init?.headers as Record<string, string> | undefined;

    calls.push({
      method: init?.method ?? "GET",
      url,
      authorization: headers?.Authorization
    });

    if (url.endsWith("/17/attempts")) {
      return new Response(null, { status: 202 });
    }

    if (url.endsWith("/17")) {
      return new Response(
        JSON.stringify({
          id: 17,
          guid: "guid-17",
          event: "issue_comment",
          delivered_at: "2026-04-02T11:30:00.000Z",
          redelivery: false,
          status: "FAILED",
          status_code: 500,
          request: {
            payload: {
              action: "created",
              repository: { full_name: "acme/demo" },
              sender: { login: "octocat" },
              installation: { id: 42 },
              issue: {
                number: 7,
                body: "Need a plan",
                state: "open"
              },
              comment: {
                id: 99,
                body: "@github-agent-orchestrator /approve"
              }
            }
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }

    return new Response(
      JSON.stringify([
        {
          id: 17,
          guid: "guid-17",
          delivered_at: "2026-04-02T11:30:00.000Z",
          redelivery: false,
          status: "FAILED",
          status_code: 500
        }
      ]),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: '<https://api.github.com/app/hook/deliveries?cursor=abc>; rel="next"'
        }
      }
    );
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const page = await fetchGitHubAppWebhookDeliveryClient.listDeliveries("jwt-token");
  const detail = await fetchGitHubAppWebhookDeliveryClient.getDelivery("jwt-token", 17);

  assert.deepEqual(page.deliveries, [
    {
      id: 17,
      guid: "guid-17",
      deliveredAt: "2026-04-02T11:30:00.000Z",
      redelivery: false,
      status: "FAILED",
      statusCode: 500
    }
  ]);
  assert.equal(page.nextPageUrl, "https://api.github.com/app/hook/deliveries?cursor=abc");
  assert.deepEqual(detail, {
    id: 17,
    guid: "guid-17",
    eventName: "issue_comment",
    deliveredAt: "2026-04-02T11:30:00.000Z",
    redelivery: false,
    status: "FAILED",
    statusCode: 500,
    payload: {
      action: "created",
      repository: { full_name: "acme/demo" },
      sender: { login: "octocat" },
      installation: { id: 42 },
      issue: {
        number: 7,
        body: "Need a plan",
        state: "open"
      },
      comment: {
        id: 99,
        body: "@github-agent-orchestrator /approve"
      }
    }
  });

  await fetchGitHubAppWebhookDeliveryClient.redeliverDelivery("jwt-token", 17);

  assert.deepEqual(calls, [
    {
      method: "GET",
      url: "https://api.github.com/app/hook/deliveries?per_page=100",
      authorization: "Bearer jwt-token"
    },
    {
      method: "GET",
      url: "https://api.github.com/app/hook/deliveries/17",
      authorization: "Bearer jwt-token"
    },
    {
      method: "POST",
      url: "https://api.github.com/app/hook/deliveries/17/attempts",
      authorization: "Bearer jwt-token"
    }
  ]);
});

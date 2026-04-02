import assert from "node:assert/strict";
import test from "node:test";

import { fetchGitHubAppWebhookDeliveryClient } from "../../src/app/providers/github-redelivery-client.js";

test("fetchGitHubAppWebhookDeliveryClient lists deliveries and follows pagination metadata", async (t) => {
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

    if (url.endsWith("/attempts")) {
      return new Response(null, { status: 202 });
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

  await fetchGitHubAppWebhookDeliveryClient.redeliverDelivery("jwt-token", 17);

  assert.deepEqual(calls, [
    {
      method: "GET",
      url: "https://api.github.com/app/hook/deliveries?per_page=100",
      authorization: "Bearer jwt-token"
    },
    {
      method: "POST",
      url: "https://api.github.com/app/hook/deliveries/17/attempts",
      authorization: "Bearer jwt-token"
    }
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";

import { fetchHelper, initFetchHelper } from "../../../src/providers/http/fetch-helper.js";

interface FetchCall {
  dispatcherName?: string;
  method: string;
}

test("fetchHelper resets to passthrough when proxying is disabled", async (t) => {
  const originalFetch = global.fetch;
  const calls: FetchCall[] = [];

  global.fetch = async (_input, init?: RequestInit & { dispatcher?: { constructor?: { name?: string } } }) => {
    calls.push({
      dispatcherName: init?.dispatcher?.constructor?.name,
      method: init?.method ?? "GET"
    });
    return new Response("ok");
  };

  t.after(() => {
    global.fetch = originalFetch;
    initFetchHelper(undefined);
  });

  await fetchHelper("https://example.com", { method: "POST" });
  initFetchHelper({ proxy: "http://127.0.0.1:8080" });
  await fetchHelper("https://example.com");
  initFetchHelper(undefined);
  await fetchHelper("https://example.com");

  assert.deepEqual(calls, [
    { dispatcherName: undefined, method: "POST" },
    { dispatcherName: "ProxyAgent", method: "GET" },
    { dispatcherName: undefined, method: "GET" }
  ]);
});

test("fetchHelper attaches a dispatcher for socks5 proxies", async (t) => {
  const originalFetch = global.fetch;
  let dispatcherName: string | undefined;

  global.fetch = async (_input, init?: RequestInit & { dispatcher?: { constructor?: { name?: string } } }) => {
    dispatcherName = init?.dispatcher?.constructor?.name;
    return new Response("ok");
  };

  t.after(() => {
    global.fetch = originalFetch;
    initFetchHelper(undefined);
  });

  initFetchHelper({ proxy: "socks5://proxy-user:proxy-pass@127.0.0.1:1080" });
  await fetchHelper("https://example.com");

  assert.ok(dispatcherName);
});

test("fetchHelper retries thrown network failures with the default retry budget", async (t) => {
  const originalFetch = global.fetch;
  let callCount = 0;

  global.fetch = async () => {
    callCount += 1;

    if (callCount < 4) {
      throw new Error(`network failure ${callCount}`);
    }

    return new Response("ok");
  };

  t.after(() => {
    global.fetch = originalFetch;
    initFetchHelper(undefined);
  });

  const response = await fetchHelper("https://example.com");

  assert.equal(await response.text(), "ok");
  assert.equal(callCount, 4);
});

test("fetchHelper rethrows after exhausting the configured retry budget", async (t) => {
  const originalFetch = global.fetch;
  let callCount = 0;

  global.fetch = async () => {
    callCount += 1;
    throw new Error("network failure");
  };

  t.after(() => {
    global.fetch = originalFetch;
    initFetchHelper(undefined);
  });

  initFetchHelper({ maxRetry: 1 });

  await assert.rejects(() => fetchHelper("https://example.com"), /network failure/);
  assert.equal(callCount, 2);
});

test("fetchHelper does not retry resolved HTTP error responses", async (t) => {
  const originalFetch = global.fetch;
  let callCount = 0;

  global.fetch = async () => {
    callCount += 1;
    return new Response("bad gateway", { status: 502 });
  };

  t.after(() => {
    global.fetch = originalFetch;
    initFetchHelper(undefined);
  });

  initFetchHelper({ maxRetry: 5 });

  const response = await fetchHelper("https://example.com");

  assert.equal(response.status, 502);
  assert.equal(callCount, 1);
});

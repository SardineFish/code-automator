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
  initFetchHelper("http://127.0.0.1:8080");
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

  initFetchHelper("socks5://proxy-user:proxy-pass@127.0.0.1:1080");
  await fetchHelper("https://example.com");

  assert.ok(dispatcherName);
});

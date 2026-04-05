import assert from "node:assert/strict";
import test from "node:test";

import { App } from "../../src/app/app.js";
import type { HttpProviderKey } from "../../src/types/provider-keys.js";
import type { AppContext, HttpRequestProvider, ProviderHandler } from "../../src/types/runtime.js";

const appBuilder = null as unknown as ReturnType<typeof App>;
const appContext = null as unknown as AppContext;
const httpRoute: HttpProviderKey = "/chat";
const httpProvider = null as unknown as HttpRequestProvider;
const customProvider = null as unknown as ProviderHandler<[string], number>;

if (false) {
  appBuilder.provider(httpRoute, httpProvider);
  appBuilder.provider("/chat", httpProvider);
  appBuilder.provider<[import("node:http").IncomingMessage, import("node:http").ServerResponse], void>(
    "/chat",
    httpProvider
  );
  appBuilder.provider("github:redelivery", customProvider);

  const lookedUpHttpProvider: HttpRequestProvider = appContext.getProvider(httpRoute);
  const lookedUpLiteralHttpProvider: HttpRequestProvider = appContext.getProvider("/chat");
  const lookedUpCustomProvider = appContext.getProvider<typeof customProvider>("github:redelivery");

  void lookedUpHttpProvider;
  void lookedUpLiteralHttpProvider;
  void lookedUpCustomProvider;

  // @ts-expect-error Slash-prefixed keys must use HttpRequestProvider handlers.
  appBuilder.provider("/chat", customProvider);

  // @ts-expect-error Slash-prefixed lookups infer HttpRequestProvider by default.
  const wrongLookup: ProviderHandler<[string], number> = appContext.getProvider("/chat");
  void wrongLookup;
}

test("slash-prefixed provider key typings compile", () => {
  assert.equal(httpRoute, "/chat");
});

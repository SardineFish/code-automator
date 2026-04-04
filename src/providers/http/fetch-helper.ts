import { socksDispatcher } from "fetch-socks";
import { ProxyAgent, type Dispatcher } from "undici";

import type { FetchConfig } from "../../types/config.js";

const SUPPORTED_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks5:"]);
const DEFAULT_MAX_RETRY = 3;

type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = NonNullable<Parameters<typeof globalThis.fetch>[1]> & { dispatcher?: Dispatcher };

let currentDispatcher: Dispatcher | undefined;
let currentProxy: string | undefined;
let currentMaxRetry = DEFAULT_MAX_RETRY;

interface SocksProxyConfig {
  type: 5;
  host: string;
  port: number;
  userId?: string;
  password?: string;
}

export function initFetchHelper(config: FetchConfig | undefined): void {
  const proxy = config?.proxy;
  const maxRetry = config?.maxRetry ?? DEFAULT_MAX_RETRY;

  if (proxy === currentProxy && maxRetry === currentMaxRetry) {
    return;
  }

  currentMaxRetry = maxRetry;

  if (proxy === currentProxy) {
    return;
  }

  const nextDispatcher = proxy ? createProxyDispatcher(proxy) : undefined;
  const previousDispatcher = currentDispatcher;

  currentProxy = proxy;
  currentDispatcher = nextDispatcher;

  if (previousDispatcher) {
    void previousDispatcher.destroy().catch(() => {});
  }
}

export function fetchHelper(
  input: FetchInput,
  init?: Parameters<typeof globalThis.fetch>[1]
): ReturnType<typeof globalThis.fetch> {
  const dispatcher = currentDispatcher;
  const maxRetry = currentMaxRetry;

  return fetchWithRetry(input, createRequestInit(init, dispatcher), maxRetry);
}

function createProxyDispatcher(proxy: string): Dispatcher {
  const url = new URL(proxy);

  if (!SUPPORTED_PROXY_PROTOCOLS.has(url.protocol)) {
    throw new Error(`Unsupported proxy protocol '${url.protocol}'.`);
  }

  return url.protocol === "socks5:"
    ? socksDispatcher(createSocksProxy(url))
    : new ProxyAgent({ uri: url.toString() });
}

function createSocksProxy(url: URL): SocksProxyConfig {
  return {
    type: 5,
    host: url.hostname,
    port: readPort(url, 1080),
    userId: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined
  };
}

function readPort(url: URL, fallbackPort: number): number {
  if (url.port === "") {
    return fallbackPort;
  }

  const port = Number.parseInt(url.port, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid proxy port '${url.port}'.`);
  }

  return port;
}

function createRequestInit(
  init: Parameters<typeof globalThis.fetch>[1],
  dispatcher: Dispatcher | undefined
): Parameters<typeof globalThis.fetch>[1] {
  if (!dispatcher) {
    return init;
  }

  return {
    ...(init ?? {}),
    dispatcher
  } as FetchInit;
}

async function fetchWithRetry(
  input: FetchInput,
  init: Parameters<typeof globalThis.fetch>[1],
  maxRetry: number
): ReturnType<typeof globalThis.fetch> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await globalThis.fetch(input, init);
    } catch (error) {
      if (attempt >= maxRetry) {
        throw error;
      }
    }
  }
}

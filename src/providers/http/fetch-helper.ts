import { socksDispatcher } from "fetch-socks";
import { ProxyAgent, type Dispatcher } from "undici";

const SUPPORTED_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks5:"]);

type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = NonNullable<Parameters<typeof globalThis.fetch>[1]> & { dispatcher?: Dispatcher };

let currentDispatcher: Dispatcher | undefined;
let currentProxy: string | undefined;

interface SocksProxyConfig {
  type: 5;
  host: string;
  port: number;
  userId?: string;
  password?: string;
}

export function initFetchHelper(proxy: string | undefined): void {
  if (proxy === currentProxy) {
    return;
  }

  const previousDispatcher = currentDispatcher;
  currentProxy = proxy;
  currentDispatcher = proxy ? createProxyDispatcher(proxy) : undefined;

  if (previousDispatcher) {
    void previousDispatcher.destroy().catch(() => {});
  }
}

export function fetchHelper(
  input: FetchInput,
  init?: Parameters<typeof globalThis.fetch>[1]
): ReturnType<typeof globalThis.fetch> {
  if (!currentDispatcher) {
    return globalThis.fetch(input, init);
  }

  const requestInit: FetchInit = {
    ...(init ?? {}),
    dispatcher: currentDispatcher
  };

  return globalThis.fetch(input, requestInit);
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

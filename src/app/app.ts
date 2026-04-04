import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { initFetchHelper } from "../providers/http/fetch-helper.js";
import type { ServiceConfig } from "../types/config.js";
import type { LogSink } from "../types/logging.js";
import type { AppContext } from "../types/runtime.js";
import { createAppRuntimeOptions, type AppRuntimeOptions, type AppRuntimeOverrides, initializeWorkflowTracking } from "./default-app-runtime.js";
import { createAppContext } from "./create-app-context.js";
import { createRequestDrainController } from "./request-drain.js";
export type AppOptions = AppRuntimeOverrides;
export interface AppLifecycle {
  server: Server;
  stopAcceptingRequests(): Promise<void>;
  waitForIdleRequests(): Promise<void>;
}
export type ProviderHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  context: AppContext
) => Promise<void> | void;
export function App(config: ServiceConfig, options: AppOptions = {}): AppBuilder {
  initFetchHelper(config.proxy);
  return new AppBuilder(config, createAppRuntimeOptions(config, options));
}

class AppBuilder {
  readonly #providers = new Map<string, ProviderHandler>();
  #initializePromise?: Promise<void>;

  constructor(
    private readonly config: ServiceConfig,
    private readonly runtime: AppRuntimeOptions
  ) {}

  provider(routePath: string, handler: ProviderHandler): AppBuilder {
    if (!routePath.startsWith("/")) {
      throw new Error(`Provider route '${routePath}' must start with '/'.`);
    }
    if (this.#providers.has(routePath)) {
      throw new Error(`Provider route '${routePath}' is already registered.`);
    }

    this.#providers.set(routePath, handler);
    return this;
  }

  async listen(): Promise<AppLifecycle> {
    await this.initialize();

    const server = createServer((request, response) => {
      const path = getRequestPath(request);
      const requestLogSink = this.runtime.logSink.child({ path });
      logCompletedRequest(request, response, path, requestLogSink);

      if (!requestDrain.tryStartRequest(response)) {
        respond(response, 503, "Service Unavailable");
        return;
      }

      void this.handleRequest(path, request, response).catch((error) => {
        requestLogSink.error({
          message: "provider request handling failed",
          method: request.method ?? "UNKNOWN",
          errorMessage: error instanceof Error ? error.message : "Unknown request handling error."
        });

        if (!response.headersSent) {
          respond(response, 500, "Internal Server Error");
        }
      });
    });
    const requestDrain = createRequestDrainController(server);

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.config.server.port, this.config.server.host, () => {
        server.off("error", reject);
        resolve();
      });
    });

    this.runtime.logSink.info({
      message: "server listening",
      host: this.config.server.host,
      port: this.config.server.port,
      routePaths: [...this.#providers.keys()]
    });

    return {
      server,
      stopAcceptingRequests() {
        return requestDrain.stopAcceptingRequests();
      },
      waitForIdleRequests() {
        return requestDrain.waitForIdleRequests();
      }
    };
  }

  async handleRequest(
    routePath: string,
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const handler = this.#providers.get(routePath);

    if (!handler) {
      respond(response, 404, "Not Found");
      return;
    }

    const context = createAppContext(routePath, this.config, this.runtime);
    await handler(request, response, context);

    if (!response.headersSent) {
      respond(response, 500, "Provider did not send a response");
    }
  }

  private initialize(): Promise<void> {
    this.#initializePromise ??= initializeWorkflowTracking(this.config, this.runtime);
    return this.#initializePromise;
  }
}

function getRequestPath(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://127.0.0.1").pathname;
}

function logCompletedRequest(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  logSink: LogSink
): void {
  const startedAt = process.hrtime.bigint();
  const method = request.method ?? "UNKNOWN";

  response.once("finish", () => {
    logSink.debug({
      message: "http request completed",
      method,
      status: response.statusCode,
      durationMs: Number((process.hrtime.bigint() - startedAt) / BigInt(1_000_000))
    });
  });
}

function respond(response: ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
  response.end(body);
}

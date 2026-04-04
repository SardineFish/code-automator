import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { LogSink } from "../types/logging.js";
import type { AppContext, AppServiceHandler, ProviderHandler } from "../types/runtime.js";
import { createRequestDrainController, type RequestDrainController } from "./request-drain.js";
import { UnknownProviderError } from "./create-app-context.js";

export type HttpRequestProvider = ProviderHandler<[IncomingMessage, ServerResponse], void>;

export interface HttpAppService {
  server: Server;
  requestDrain: RequestDrainController;
}

export interface ManagedHttpAppService {
  service: AppServiceHandler;
  getServer(): Server;
  waitForIdleRequests(): Promise<void>;
}

export function createHttpAppService(
  serverConfig: { host: string; port: number },
  logSink: LogSink
): ManagedHttpAppService {
  let started: HttpAppService | undefined;

  return {
    async service(appContext) {
      started = await startHttpAppService(serverConfig, logSink, appContext);
      const startedService = started;

      appContext.on("shutdown", async () => {
        await startedService.requestDrain.stopAcceptingRequests();
      });
    },
    getServer() {
      if (!started) {
        throw new Error("HTTP app service has not started.");
      }

      return started.server;
    },
    waitForIdleRequests() {
      if (!started) {
        return Promise.resolve();
      }

      return started.requestDrain.waitForIdleRequests();
    }
  };
}

async function startHttpAppService(
  serverConfig: { host: string; port: number },
  logSink: LogSink,
  appContext: AppContext
): Promise<HttpAppService> {
  const server = createServer((request, response) => {
    const path = getRequestPath(request);
    const requestLogSink = logSink.child({ path });
    logCompletedRequest(request, response, requestLogSink);

    if (!requestDrain.tryStartRequest(response)) {
      respond(response, 503, "Service Unavailable");
      return;
    }

    void handleRequest(path, request, response, appContext).catch((error) => {
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
    server.listen(serverConfig.port, serverConfig.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return { server, requestDrain };
}

async function handleRequest(
  path: string,
  request: IncomingMessage,
  response: ServerResponse,
  appContext: AppContext
): Promise<void> {
  let handler: HttpRequestProvider;

  try {
    handler = appContext.getProvider<HttpRequestProvider>(path);
  } catch (error) {
    if (error instanceof UnknownProviderError) {
      respond(response, 404, "Not Found");
      return;
    }

    throw error;
  }

  const workflow = appContext.createWorkflow(path);
  await handler(workflow, request, response);

  if (!response.headersSent) {
    respond(response, 500, "Provider did not send a response");
  }
}

function getRequestPath(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://127.0.0.1").pathname;
}

function logCompletedRequest(
  request: IncomingMessage,
  response: ServerResponse,
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

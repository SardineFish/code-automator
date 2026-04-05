import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { LogSink } from "../types/logging.js";
import type { HttpProviderKey } from "../types/provider-keys.js";
import type { AppContext, HttpRequestProvider } from "../types/runtime.js";
import { createRequestDrainController, type RequestDrainController } from "./request-drain.js";
import { UnknownProviderError } from "./create-app-context.js";

export interface HttpAppService {
  server: Server;
  requestDrain: RequestDrainController;
}

export async function startHttpAppService(
  appContext: AppContext,
  logSink: LogSink = appContext.log
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
    server.listen(appContext.config.server.port, appContext.config.server.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return { server, requestDrain };
}

async function handleRequest(
  path: HttpProviderKey,
  request: IncomingMessage,
  response: ServerResponse,
  appContext: AppContext
): Promise<void> {
  let handler: HttpRequestProvider;

  try {
    handler = appContext.getProvider(path);
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

function getRequestPath(request: IncomingMessage): HttpProviderKey {
  return new URL(request.url ?? "/", "http://127.0.0.1").pathname as HttpProviderKey;
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

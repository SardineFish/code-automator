import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { getWhitelistRejectionReason } from "../../service/orchestration/check-whitelist.js";
import { extractWebhookGateContext } from "../../service/normalize/normalize-webhook-event.js";
import { verifyWebhookSignature } from "../../service/security/verify-webhook-signature.js";
import type { ServiceConfig } from "../../types/config.js";
import type { DeliveryContext, LogSink, OrchestrationResult, RuntimeLogRecord } from "../../types/runtime.js";
import { RequestBodyError, readRequestBody } from "./read-request-body.js";

export interface CreateWebhookServerOptions {
  config: ServiceConfig;
  webhookSecret: string;
  logSink: LogSink;
  onDelivery(delivery: DeliveryContext): Promise<OrchestrationResult>;
}

export function createWebhookServer(options: CreateWebhookServerOptions): Server {
  return createServer((request, response) => {
    void handleRequest(request, response, options).catch((error) => {
      options.logSink.error(
        logRecord("error", "webhook request handling failed", undefined, "unknown", {
          reason: "request_handling_failed",
          errorMessage: error instanceof Error ? error.message : "Unknown request handling error."
        })
      );

      if (!response.headersSent) {
        respond(response, 500, "Internal Server Error");
      }
    });
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: CreateWebhookServerOptions
): Promise<void> {
  if (getRequestPath(request) !== options.config.server.webhookPath) {
    respond(response, 404, "Not Found");
    return;
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    respond(response, 405, "Method Not Allowed");
    return;
  }
  let body: Buffer;

  try {
    body = await readRequestBody(request);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      respond(response, error.statusCode, error.message);
      return;
    }

    throw error;
  }

  const signature = getHeader(request, "x-hub-signature-256");

  if (!verifyWebhookSignature(options.webhookSecret, body, signature)) {
    respond(response, 401, "Invalid signature");
    return;
  }

  const eventName = getHeader(request, "x-github-event");
  if (!eventName) {
    respond(response, 400, "Missing X-GitHub-Event header");
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    respond(response, 400, "Invalid JSON");
    return;
  }

  const deliveryId = getHeader(request, "x-github-delivery");
  const gate = extractWebhookGateContext(payload);

  if (!gate) {
    options.logSink.info(
      logRecord("info", "ignored delivery without gate context", deliveryId, eventName, {
        reason: "missing_gate_context"
      })
    );
    respond(response, 202, "Ignored");
    return;
  }

  const rejectionReason = getWhitelistRejectionReason(options.config, gate);

  if (rejectionReason) {
    options.logSink.info(
      logRecord("info", "ignored delivery rejected by whitelist", deliveryId, eventName, {
        reason: rejectionReason,
        actorLogin: gate.actorLogin,
        repo: gate.repoFullName
      })
    );
    respond(response, 202, "Ignored");
    return;
  }

  respond(response, 202, "Accepted");

  void options.onDelivery({ deliveryId, eventName, payload })
    .then((result) => {
      options.logSink.info(
        logRecord("info", "processed webhook delivery", deliveryId, eventName, {
          ...result
        })
      );
    })
    .catch((error) => {
      options.logSink.error(
        logRecord("error", "webhook delivery failed", deliveryId, eventName, {
          status: "failed",
          reason: "unhandled_error",
          errorMessage: error instanceof Error ? error.message : "Unknown webhook error."
        })
      );
    });
}

function getHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function getRequestPath(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://127.0.0.1").pathname;
}

function logRecord(
  level: "info" | "error",
  message: string,
  deliveryId: string | undefined,
  eventName: string,
  fields: Record<string, unknown>
): RuntimeLogRecord {
  return { timestamp: new Date().toISOString(), level, message, deliveryId, eventName, ...fields };
}

function respond(response: ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
  response.end(body);
}

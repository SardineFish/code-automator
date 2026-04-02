import type { IncomingMessage, ServerResponse } from "node:http";

import type { InstallationTokenProvider } from "../service/github/create-installation-token-provider.js";
import type { GitHubRuntimeConfig } from "../service/github/read-github-runtime-config.js";
import { normalizeWebhookEvent, extractWebhookGateContext } from "../service/normalize/normalize-webhook-event.js";
import { getWhitelistRejectionReason } from "../service/orchestration/check-whitelist.js";
import { verifyWebhookSignature } from "../service/security/verify-webhook-signature.js";
import type { AppContext, LogSink, OrchestrationResult } from "../types/runtime.js";
import { RequestBodyError, readRequestBody } from "../runtime/http/read-request-body.js";

export interface CreateGitHubRequestHandlerOptions {
  github: GitHubRuntimeConfig;
  webhookSecret: string;
  installationTokenProvider: InstallationTokenProvider;
  logSink: LogSink;
}

export function createGitHubRequestHandler(options: CreateGitHubRequestHandlerOptions) {
  return async (request: IncomingMessage, response: ServerResponse, context: AppContext): Promise<void> => {
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
      options.logSink.info(logRecord("info", "ignored delivery without gate context", deliveryId, eventName, {
        reason: "missing_gate_context"
      }));
      respond(response, 202, "Ignored");
      return;
    }

    const rejectionReason = getWhitelistRejectionReason(options.github.whitelist, gate);
    if (rejectionReason) {
      options.logSink.info(logRecord("info", "ignored delivery rejected by whitelist", deliveryId, eventName, {
        reason: rejectionReason,
        actorLogin: gate.actorLogin,
        repo: gate.repoFullName
      }));
      respond(response, 202, "Ignored");
      return;
    }

    const normalized = normalizeWebhookEvent({
      eventName,
      deliveryId,
      payload,
      botHandle: options.github.botHandle
    });
    if (!normalized) {
      options.logSink.info(logRecord("info", "processed webhook delivery", deliveryId, eventName, {
        status: "ignored",
        reason: "unsupported_event"
      }));
      respond(response, 202, "Accepted");
      return;
    }

    const installationToken = await options.installationTokenProvider.createInstallationToken(
      options.github.clientId,
      normalized.input.installation.id
    );
    for (const triggerName of normalized.candidateTriggers) {
      context.trigger(triggerName, {
        in: {
          ...normalized.input,
          event: {
            ...normalized.input.event,
            matchedTrigger: triggerName
          }
        },
        env: { GITHUB_TOKEN: installationToken }
      });
    }

    const result = await context.submit();
    options.logSink.info(logRecord("info", "processed webhook delivery", deliveryId, eventName, {
      ...result
    }));
    respond(response, 202, responseBodyFor(result));
  };
}

function getHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function logRecord(
  level: "info" | "error",
  message: string,
  deliveryId: string | undefined,
  eventName: string,
  fields: Record<string, unknown>
) {
  return { timestamp: new Date().toISOString(), level, message, deliveryId, eventName, ...fields };
}

function respond(response: ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
  response.end(body);
}

function responseBodyFor(result: OrchestrationResult): string {
  return result.status === "failed" ? "Failed" : "Accepted";
}

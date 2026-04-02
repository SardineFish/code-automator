import type { IncomingMessage, ServerResponse } from "node:http";

import type { InstallationTokenProvider } from "../../service/github/create-installation-token-provider.js";
import type { GitHubProviderConfig } from "../../service/github/read-github-provider-config.js";
import { extractWebhookGateContext, normalizeWebhookEvent } from "../../service/normalize/normalize-webhook-event.js";
import { getWhitelistRejectionReason } from "../../service/orchestration/check-whitelist.js";
import { verifyWebhookSignature } from "../../service/security/verify-webhook-signature.js";
import type { LogSink } from "../../types/logging.js";
import type { AppContext, OrchestrationResult } from "../../types/runtime.js";
import { RequestBodyError, readRequestBody } from "../../runtime/http/read-request-body.js";
import { buildDebugContentFields } from "./github-provider-debug-content.js";

export interface CreateGitHubProviderHandlerOptions {
  github: GitHubProviderConfig;
  webhookSecret: string;
  installationTokenProvider: InstallationTokenProvider;
  logSink: LogSink;
}

export function createGitHubProviderHandler(options: CreateGitHubProviderHandlerOptions) {
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
    const requestLog = options.logSink.child({ deliveryId, eventName });
    const gate = extractWebhookGateContext(payload);
    if (!gate) {
      requestLog.info({
        message: "ignored delivery without gate context",
        reason: "missing_gate_context"
      });
      respond(response, 202, "Ignored");
      return;
    }

    const gatedLog = requestLog.child({
      repo: gate.repoFullName,
      actorLogin: gate.actorLogin
    });
    const rejectionReason = getWhitelistRejectionReason(options.github.whitelist, gate);
    if (rejectionReason) {
      gatedLog.info({
        message: "ignored delivery rejected by whitelist",
        reason: rejectionReason,
      });
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
      gatedLog.info({
        message: "processed webhook delivery",
        status: "ignored",
        reason: "unsupported_event"
      });
      respond(response, 202, "Accepted");
      return;
    }

    const normalizedLog = gatedLog.child({
      installationId: normalized.input.installation.id,
      action: normalized.action
    });
    const debugContentFields = buildDebugContentFields(normalized);
    if (debugContentFields && normalizedLog.isLevelEnabled("debug")) {
      normalizedLog.debug({
        message: "normalized webhook content",
        ...debugContentFields
      });
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
    normalizedLog.info({
      message: "processed webhook delivery",
      ...result
    });
    respond(response, 202, responseBodyFor(result));
  };
}

function getHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function respond(response: ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
  response.end(body);
}

function responseBodyFor(result: OrchestrationResult): string {
  return result.status === "failed" ? "Failed" : "Accepted";
}

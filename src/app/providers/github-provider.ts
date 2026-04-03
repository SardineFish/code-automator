import type { IncomingMessage, ServerResponse } from "node:http";

import { verifyWebhookSignature } from "../../service/security/verify-webhook-signature.js";
import type { AppContext } from "../../types/runtime.js";
import {
  evaluateGitHubDelivery,
  normalizeGitHubDeliveryPayload
} from "./github-delivery-relevance.js";
import { resolveGitHubProviderConfig } from "./github-config.js";
import {
  addCommentReaction,
  addThreadComment,
  getHeader,
  getInstallationTokenProvider,
  readBody,
  readObject,
  readPayload,
  requireEnv,
  respond
} from "./github-utils.js";

/**
 * GitHub provider trigger contract.
 *
 * Supported canonical triggers:
 * - issue:open
 *   Emitted for GitHub "issues" events when action === "opened".
 * - issue:command:plan
 * - issue:command:approve
 *   Emitted for GitHub "issue_comment" events on issues when the comment
 *   starts with a bot mention followed by one of the supported commands.
 * - issue:comment
 *   Emitted for GitHub "issue_comment" events on issues when the comment
 *   starts with a bot mention, including command comments.
 * - pr:comment
 *   Emitted for GitHub "issue_comment" events on pull requests and for
 *   GitHub "pull_request_review_comment" events.
 * - pr:review
 *   Emitted for GitHub "pull_request_review" events.
 *
 * The provider keeps the workflow input intentionally small. It emits only the
 * fields needed by the current workflows: event, user, repo, issueId, prId,
 * content, prReview, and command.
 */
export async function githubProvider(
  request: IncomingMessage,
  response: ServerResponse,
  context: AppContext
): Promise<void> {
  const github = resolveGitHubProviderConfig(context.config.gh);

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return respond(response, 405, "Method Not Allowed");
  }

  const body = await readBody(request, response);
  if (!body) {
    return;
  }

  if (!verifyWebhookSignature(requireEnv(context.env, "GITHUB_WEBHOOK_SECRET"), body, getHeader(request, "x-hub-signature-256"))) {
    return respond(response, 401, "Invalid signature");
  }

  const eventName = getHeader(request, "x-github-event");
  if (!eventName) {
    return respond(response, 400, "Missing X-GitHub-Event header");
  }

  const payload = readPayload(body, response);
  if (!payload) {
    return;
  }

  const delivery = normalizeGitHubDeliveryPayload(payload);
  const evaluation = evaluateGitHubDelivery(eventName, delivery, github);
  const gate = evaluation.status === "relevant" ? evaluation.delivery.gate : evaluation.gate;
  const requestLog = context.log.child({ eventName, actorLogin: gate?.actorLogin, repo: gate?.repoFullName });

  if (evaluation.status === "ignored") {
    if (evaluation.reason === "missing_gate_context") {
      requestLog.info({ message: "ignored delivery without gate context", reason: evaluation.reason });
      return respond(response, 202, "Ignored");
    }

    if (evaluation.reason === "repo_not_whitelisted" || evaluation.reason === "actor_not_whitelisted") {
      requestLog.info({ message: "ignored delivery rejected by whitelist", reason: evaluation.reason });
      return respond(response, 202, "Ignored");
    }

    requestLog.info({ message: "processed webhook delivery", status: "ignored", reason: evaluation.reason });
    return respond(response, 202, "Accepted");
  }

  const installationToken = await getInstallationTokenProvider(requireEnv(context.env, "GITHUB_APP_PRIVATE_KEY_PATH"))
    .createInstallationToken(github.clientId, evaluation.delivery.gate.installationId);
  const repo = evaluation.delivery.gate.repoFullName;
  const triggerEnv = { GH_TOKEN: installationToken };
  const reportTarget = getReportTarget(eventName, payload);

  try {
    for (const trigger of evaluation.delivery.triggers) {
      context.trigger(trigger.name, {
        in: trigger.input,
        env: triggerEnv
      });
    }

    const result = await context.submit();

    if (result.status === "matched" && evaluation.delivery.reactionTarget) {
      try {
        await addCommentReaction({
          repoFullName: repo,
          subjectId: evaluation.delivery.reactionTarget.subjectId,
          reaction: "eyes",
          token: installationToken,
          kind: evaluation.delivery.reactionTarget.kind
        });
      } catch (error) {
        requestLog.warn({
          message: "failed to add comment reaction",
          errorMessage: error instanceof Error ? error.message : "Unknown reaction error."
        });
      }
    }

    requestLog.info({ message: "processed webhook delivery", ...result });
    respond(response, 202, result.status === "failed" ? "Failed" : "Accepted");
  } catch (error) {
    requestLog.error({
      message: "github provider handler failed",
      errorMessage: error instanceof Error ? error.message : "Unknown GitHub provider error."
    });

    if (reportTarget) {
      try {
        await addThreadComment({
          repoFullName: repo,
          subjectId: reportTarget.subjectId,
          body: formatRuntimeErrorComment(error),
          token: installationToken,
          kind: reportTarget.kind
        });
      } catch (reportError) {
        requestLog.warn({
          message: "failed to post GitHub runtime error comment",
          errorMessage: reportError instanceof Error ? reportError.message : "Unknown GitHub reporting error."
        });
      }
    }

    respond(response, 500, "Internal Server Error");
  }
}

function getReportTarget(
  eventName: string,
  payload: Record<string, unknown>
): { subjectId: number; kind: "issue" | "pull_request" } | undefined {
  const issue = readObject(payload, "issue");
  const pullRequest = readObject(payload, "pull_request");

  if (eventName === "issues" || eventName === "issue_comment") {
    const subjectId = readSubjectNumber(issue);
    if (subjectId === undefined) {
      return undefined;
    }

    return {
      subjectId,
      kind: readObject(issue ?? {}, "pull_request") ? "pull_request" : "issue"
    };
  }

  if (eventName === "pull_request_review" || eventName === "pull_request_review_comment") {
    const subjectId = readSubjectNumber(pullRequest);
    if (subjectId === undefined) {
      return undefined;
    }

    return { subjectId, kind: "pull_request" };
  }

  return undefined;
}

function readSubjectNumber(value: Record<string, unknown> | null): number | undefined {
  const number = value?.number;
  return typeof number === "number" && Number.isInteger(number) ? number : undefined;
}

function formatRuntimeErrorComment(error: unknown): string {
  const fallback = error instanceof Error ? error.message : "Unknown GitHub provider error.";
  const details = error instanceof Error && error.stack ? error.stack : fallback;

  return [
    "Coding Automator hit a JavaScript runtime error while handling this webhook.",
    "",
    "```text",
    details,
    "```"
  ].join("\n");
}

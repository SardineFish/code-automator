import type { IncomingMessage, ServerResponse } from "node:http";

import { getWhitelistRejectionReason } from "../../service/orchestration/check-whitelist.js";
import { verifyWebhookSignature } from "../../service/security/verify-webhook-signature.js";
import type { AppContext } from "../../types/runtime.js";
import type { GitHubInput } from "../../types/workflow-input.js";
import {
  getHeader,
  getInstallationTokenProvider,
  mapReviewState,
  parseIssueMention,
  readBody,
  readGate,
  readId,
  readObject,
  readPayload,
  readString,
  requireEnv,
  respond
} from "./github-utils.js";

export async function githubProvider(
  request: IncomingMessage,
  response: ServerResponse,
  context: AppContext
): Promise<void> {
  const github = context.config.gh;
  if (!github) {
    throw new Error("Missing gh provider config.");
  }
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

  const gate = readGate(payload);
  const requestLog = context.log.child({ eventName, actorLogin: gate?.actorLogin, repo: gate?.repoFullName });
  if (!gate) {
    requestLog.info({ message: "ignored delivery without gate context", reason: "missing_gate_context" });
    return respond(response, 202, "Ignored");
  }
  const rejectionReason = getWhitelistRejectionReason(github.whitelist, gate);
  if (rejectionReason) {
    requestLog.info({ message: "ignored delivery rejected by whitelist", reason: rejectionReason });
    return respond(response, 202, "Ignored");
  }

  const action = readString(payload, "action");
  const issue = readObject(payload, "issue");
  const comment = readObject(payload, "comment");
  const review = readObject(payload, "review");
  const pullRequest = readObject(payload, "pull_request");
  const baseInput: Omit<GitHubInput, "event"> = { user: gate.actorLogin };
  const triggerNames: string[] = [];

  if (eventName === "issues" && action === "opened") {
    const issueId = readId(issue);
    if (!issueId) {
      return respond(response, 202, "Accepted");
    }
    baseInput.issueId = issueId;
    baseInput.content = readString(issue ?? {}, "body");
    triggerNames.push("issue:open");
  } else if (eventName === "issue_comment" && action === "created") {
    const issueId = readId(issue);
    if (!issueId || !comment) {
      return respond(response, 202, "Accepted");
    }
    const content = readString(comment, "body") ?? "";
    if (readObject(issue ?? {}, "pull_request")) {
      baseInput.prId = issueId;
      baseInput.content = content;
      triggerNames.push("pr:comment");
    } else {
      const mention = parseIssueMention(content, github.botHandle);
      if (!mention.hasMention) {
        requestLog.info({ message: "processed webhook delivery", status: "ignored", reason: "unsupported_event" });
        return respond(response, 202, "Accepted");
      }
      baseInput.issueId = issueId;
      baseInput.content = mention.content;
      baseInput.command = mention.command;
      if (mention.command) {
        triggerNames.push(`issue:command:${mention.command}`);
      }
      triggerNames.push("issue:comment");
    }
  } else if (eventName === "pull_request_review_comment" && action === "created") {
    const prId = readId(pullRequest);
    if (!prId || !comment) {
      return respond(response, 202, "Accepted");
    }
    baseInput.prId = prId;
    baseInput.content = readString(comment, "body");
    triggerNames.push("pr:comment");
  } else if (eventName === "pull_request_review") {
    const prId = readId(pullRequest);
    if (!prId || !review) {
      return respond(response, 202, "Accepted");
    }
    const reviewState = readString(review, "state");
    baseInput.prId = prId;
    baseInput.prReview = mapReviewState(reviewState);
    baseInput.content = readString(review, "body")?.trim() || baseInput.prReview || reviewState;
    triggerNames.push("pr:review");
  } else {
    requestLog.info({ message: "processed webhook delivery", status: "ignored", reason: "unsupported_event" });
    return respond(response, 202, "Accepted");
  }

  const installationToken = await getInstallationTokenProvider(requireEnv(context.env, "GITHUB_APP_PRIVATE_KEY_PATH"))
    .createInstallationToken(github.clientId, gate.installationId);

  for (const triggerName of triggerNames) {
    context.trigger(triggerName, {
      in: { ...baseInput, event: triggerName },
      env: { GITHUB_TOKEN: installationToken }
    });
  }

  const result = await context.submit();
  requestLog.info({ message: "processed webhook delivery", ...result });
  respond(response, 202, result.status === "failed" ? "Failed" : "Accepted");
}

import type { IncomingMessage, ServerResponse } from "node:http";

import { getWhitelistRejectionReason } from "../../service/orchestration/check-whitelist.js";
import { verifyWebhookSignature } from "../../service/security/verify-webhook-signature.js";
import type { AppContext } from "../../types/runtime.js";
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

/**
 * GitHub provider trigger contract.
 *
 * Supported canonical triggers:
 * - issue:open
 *   Emitted for GitHub "issues" events when action === "opened".
 * - issue:command:plan
 * - issue:command:approve
 * - issue:command:go
 * - issue:command:implement
 * - issue:command:code
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
 * fields needed by the current workflows: event, user, issueId, prId, content,
 * prReview, and command.
 */
export async function githubProvider(
  request: IncomingMessage,
  response: ServerResponse,
  context: AppContext
): Promise<void> {
  // Read provider-owned config from the shared app context.
  const github = context.config.gh;
  if (!github) {
    throw new Error("Missing gh provider config.");
  }

  // Enforce the basic HTTP contract before reading the body.
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return respond(response, 405, "Method Not Allowed");
  }

  // Parse the raw request first so signature verification uses the exact bytes GitHub sent.
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

  // Decode the JSON payload once the request is authenticated.
  const payload = readPayload(body, response);
  if (!payload) {
    return;
  }

  // Apply generic provider gates before deciding which workflow triggers to emit.
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
  const user = gate.actorLogin;
  const triggerEnv = {
    GITHUB_TOKEN: await getInstallationTokenProvider(requireEnv(context.env, "GITHUB_APP_PRIVATE_KEY_PATH"))
      .createInstallationToken(github.clientId, gate.installationId)
  };

  // Route the GitHub event to the smallest set of canonical workflow triggers.
  if (eventName === "issues" && action === "opened") {
    const issueId = readId(issue);
    if (!issueId) {
      return respond(response, 202, "Accepted");
    }

    context.trigger("issue:open", {
      in: {
        event: "issue:open",
        user,
        issueId,
        content: readString(issue ?? {}, "body")
      },
      env: triggerEnv
    });
  } else if (eventName === "issue_comment" && action === "created") {
    const issueId = readId(issue);
    if (!issueId || !comment) {
      return respond(response, 202, "Accepted");
    }

    const content = readString(comment, "body") ?? "";
    if (readObject(issue ?? {}, "pull_request")) {
      // Issue comments on pull requests map directly to PR comment workflows.
      context.trigger("pr:comment", {
        in: {
          event: "pr:comment",
          user,
          prId: issueId,
          content
        },
        env: triggerEnv
      });
    } else {
      // Plain issue comments only count when they explicitly mention the bot.
      const mention = parseIssueMention(content, github.botHandle);
      if (!mention.hasMention) {
        requestLog.info({ message: "processed webhook delivery", status: "ignored", reason: "unsupported_event" });
        return respond(response, 202, "Accepted");
      }

      if (mention.command) {
        // Command-style mentions can target a specific command workflow first.
        context.trigger(`issue:command:${mention.command}`, {
          in: {
            event: `issue:command:${mention.command}`,
            user,
            issueId,
            content: mention.content,
            command: mention.command
          },
          env: triggerEnv
        });
      }

      // Every valid issue mention also emits the generic issue-comment trigger.
      context.trigger("issue:comment", {
        in: {
          event: "issue:comment",
          user,
          issueId,
          content: mention.content,
          command: mention.command
        },
        env: triggerEnv
      });
    }
  } else if (eventName === "pull_request_review_comment" && action === "created") {
    const prId = readId(pullRequest);
    if (!prId || !comment) {
      return respond(response, 202, "Accepted");
    }

    context.trigger("pr:comment", {
      in: {
        event: "pr:comment",
        user,
        prId,
        content: readString(comment, "body")
      },
      env: triggerEnv
    });
  } else if (eventName === "pull_request_review") {
    const prId = readId(pullRequest);
    if (!prId || !review) {
      return respond(response, 202, "Accepted");
    }

    const reviewState = readString(review, "state");
    const prReview = mapReviewState(reviewState);

    context.trigger("pr:review", {
      in: {
        event: "pr:review",
        user,
        prId,
        prReview,
        content: readString(review, "body")?.trim() || prReview || reviewState
      },
      env: triggerEnv
    });
  } else {
    requestLog.info({ message: "processed webhook delivery", status: "ignored", reason: "unsupported_event" });
    return respond(response, 202, "Accepted");
  }

  // The shared engine handles workflow selection, execution, and tracking.
  const result = await context.submit();
  requestLog.info({ message: "processed webhook delivery", ...result });
  respond(response, 202, result.status === "failed" ? "Failed" : "Accepted");
}

import type { IncomingMessage, ServerResponse } from "node:http";

import { getWhitelistRejectionReason } from "../../service/orchestration/check-whitelist.js";
import { verifyWebhookSignature } from "../../service/security/verify-webhook-signature.js";
import type { AppContext } from "../../types/runtime.js";
import {
  formatRuntimeErrorComment,
  formatWorkflowTerminalErrorComment,
  getReportTarget
} from "./github-provider-reporting.js";
import type { GitHubReactionTarget } from "./github-utils.js";
import {
  addGitHubReaction,
  addThreadComment,
  getHeader,
  getInstallationTokenProvider,
  mapReviewState,
  parseCommentMention,
  parseIssueMention,
  readBody,
  readGate,
  readId,
  readInteger,
  readObject,
  readPayload,
  readString,
  requireEnv,
  respond
} from "./github-utils.js";
import { resolveGitHubProviderConfig } from "./github-config.js";

/**
 * GitHub provider trigger contract.
 *
 * Supported canonical triggers:
 * - issue:open
 * - issue:close
 *   Emitted for GitHub "issues" events when action === "opened".
 * - issue:command:plan
 * - issue:command:approve
 * - issue:command:reset
 *   Emitted for GitHub "issue_comment" events on issues when the comment
 *   starts with a supported slash command after an optional leading mention.
 * - issue:at
 *   Emitted for GitHub "issue_comment" events on issues whenever the comment
 *   mentions the bot handle anywhere in the body.
 * - issue:comment
 *   Emitted for GitHub "issue_comment" events on issues when the comment is
 *   eligible for generic issue routing. By default that still requires a bot
 *   mention; setting gh.requireMention to false allows any issue comment.
 * - pr:at
 *   Emitted for GitHub PR comment events whenever the comment mentions the bot
 *   handle anywhere in the body.
 * - pr:comment
 *   Emitted for GitHub "issue_comment" events on pull requests and for
 *   GitHub "pull_request_review_comment" events.
 * - pr:review
 *   Emitted for GitHub "pull_request_review" events, except approved reviews
 *   when gh.ignoreApprovalReview is enabled.
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
  // Read provider-owned config from the shared app context.
  const github = resolveGitHubProviderConfig(context.config.gh);

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
  const gateContext = gate;

  const action = readString(payload, "action");
  const issue = readObject(payload, "issue");
  const comment = readObject(payload, "comment");
  const review = readObject(payload, "review");
  const pullRequest = readObject(payload, "pull_request");
  const deliveryId = getHeader(request, "x-github-delivery");
  const user = gateContext.actorLogin;
  const repo = gateContext.repoFullName;
  const privateKeyPath = requireEnv(context.env, "GITHUB_APP_PRIVATE_KEY_PATH");
  const installationTokenProvider = getInstallationTokenProvider(privateKeyPath);
  const installationToken = await installationTokenProvider.createInstallationToken(
    github.clientId,
    gateContext.installationId
  );
  const triggerEnv = { GH_TOKEN: installationToken };
  const reportTarget = getReportTarget(eventName, issue, pullRequest);
  let reactionTarget: GitHubReactionTarget | undefined;

  function triggerWorkflow(name: Parameters<AppContext["trigger"]>[0], input: Record<string, unknown>): void {
    context.trigger(name, {
      in: {
        ...input,
        ...(deliveryId ? { deliveryId } : {}),
        installationId: gateContext.installationId
      },
      env: triggerEnv
    });
  }

  async function addWorkflowCompletionReaction(runId: string, reactionToken?: string): Promise<void> {
    if (!reactionTarget) {
      return;
    }

    try {
      const token =
        reactionToken ??
        (await installationTokenProvider.createInstallationToken(
          github.clientId,
          gateContext.installationId
        ));
      await addGitHubReaction({
        repoFullName: repo,
        reaction: "rocket",
        token,
        target: reactionTarget
      });
    } catch (error) {
      requestLog.warn({
        message: "failed to add workflow completion reaction",
        runId,
        errorMessage: error instanceof Error ? error.message : "Unknown reaction error."
      });
    }
  }

  if (reportTarget) {
    context.on("error", async (event) => {
      try {
        const reportToken = await installationTokenProvider.createInstallationToken(
          github.clientId,
          gateContext.installationId
        );
        await addWorkflowCompletionReaction(event.runId, reportToken);
        await addThreadComment({
          repoFullName: repo,
          subjectId: reportTarget.subjectId,
          body: formatWorkflowTerminalErrorComment(event),
          token: reportToken,
          kind: reportTarget.kind
        });
      } catch (reportError) {
        requestLog.warn({
          message: "failed to post GitHub workflow terminal error comment",
          runId: event.runId,
          errorMessage: reportError instanceof Error ? reportError.message : "Unknown GitHub reporting error."
        });
      }
    });
  }

  try {
    // Route the GitHub event to the smallest set of canonical workflow triggers.
    if (eventName === "issues" && (action === "opened" || action === "closed")) {
      const issueId = readId(issue);
      if (!issueId) {
        return respond(response, 202, "Accepted");
      }
      const subjectId = readInteger(issue ?? {}, "number");
      if (subjectId !== undefined) {
        reactionTarget = { subjectId, kind: "issue" };
      }

      const issueEvent = action === "closed" ? "issue:close" : "issue:open";

      triggerWorkflow(issueEvent, {
        event: issueEvent,
        user,
        repo,
        issueId,
        content: readString(issue ?? {}, "body")
      });
    } else if (eventName === "issue_comment" && action === "created") {
      const issueId = readId(issue);
      if (!issueId || !comment) {
        return respond(response, 202, "Accepted");
      }

      const content = readString(comment, "body") ?? "";
      const commentId = readInteger(comment, "id");
      if (readObject(issue ?? {}, "pull_request")) {
        if (commentId !== undefined) {
          reactionTarget = { subjectId: commentId, kind: "issue_comment" };
        }
        const mention = parseCommentMention(content, github.botHandle);

        if (mention.hasMention) {
          triggerWorkflow("pr:at", {
            event: "pr:at",
            user,
            repo,
            prId: issueId,
            content: mention.content
          });
        }

        // Issue comments on pull requests map directly to PR comment workflows.
        triggerWorkflow("pr:comment", {
          event: "pr:comment",
          user,
          repo,
          prId: issueId,
          content
        });
      } else {
        if (readString(issue ?? {}, "state") === "closed") {
          requestLog.info({
            message: "processed webhook delivery",
            status: "ignored",
            reason: "issue_closed"
          });
          return respond(response, 202, "Accepted");
        }

        if (commentId !== undefined) {
          reactionTarget = { subjectId: commentId, kind: "issue_comment" };
        }
        const mention = parseIssueMention(content, github.botHandle, github.requireMention);
        if (mention.command) {
          // Command workflows stay more specific than mention or generic comment handlers.
          triggerWorkflow(`issue:command:${mention.command}`, {
            event: `issue:command:${mention.command}`,
            user,
            repo,
            issueId,
            content: mention.content,
            command: mention.command
          });
        }

        if (mention.hasMention) {
          triggerWorkflow("issue:at", {
            event: "issue:at",
            user,
            repo,
            issueId,
            content: mention.content,
            command: mention.command
          });
        }

        if (!mention.hasMention && github.requireMention) {
          requestLog.info({ message: "processed webhook delivery", status: "ignored", reason: "not_mentioned" });
          return respond(response, 202, "Accepted");
        }

        // Generic issue-comment workflows can still win later in YAML order.
        triggerWorkflow("issue:comment", {
          event: "issue:comment",
          user,
          repo,
          issueId,
          content: mention.content,
          command: mention.command
        });
      }
    } else if (eventName === "pull_request_review_comment" && action === "created") {
      const prId = readId(pullRequest);
      if (!prId || !comment) {
        return respond(response, 202, "Accepted");
      }
      const content = readString(comment, "body");
      const commentId = readInteger(comment, "id");
      if (commentId !== undefined) {
        reactionTarget = { subjectId: commentId, kind: "pull_request_review_comment" };
      }
      const mention = parseCommentMention(content ?? "", github.botHandle);

      if (mention.hasMention) {
        triggerWorkflow("pr:at", {
          event: "pr:at",
          user,
          repo,
          prId,
          content: mention.content
        });
      }

      triggerWorkflow("pr:comment", {
        event: "pr:comment",
        user,
        repo,
        prId,
        content
      });
    } else if (eventName === "pull_request_review") {
      const prId = readId(pullRequest);
      if (!prId || !review) {
        return respond(response, 202, "Accepted");
      }
      const reviewId = readInteger(review, "id");
      const reviewNodeId = readString(review, "node_id");
      if (reviewId !== undefined && reviewNodeId) {
        reactionTarget = {
          subjectId: reviewId,
          kind: "pull_request_review",
          nodeId: reviewNodeId
        };
      }

      const reviewState = readString(review, "state");
      if (reviewState === "approved" && github.ignoreApprovalReview) {
        requestLog.info({
          message: "processed webhook delivery",
          status: "ignored",
          reason: "approved_review_ignored"
        });
        return respond(response, 202, "Accepted");
      }

      const prReview = mapReviewState(reviewState);

      triggerWorkflow("pr:review", {
        event: "pr:review",
        user,
        repo,
        prId,
        prReview,
        content: readString(review, "body")?.trim() || prReview || reviewState
      });
    } else {
      requestLog.info({ message: "processed webhook delivery", status: "ignored", reason: "unsupported_event" });
      return respond(response, 202, "Accepted");
    }

    if (reactionTarget) {
      context.on("completed", async (event) => {
        await addWorkflowCompletionReaction(event.runId);
      });
      if (!reportTarget) {
        context.on("error", async (event) => {
          await addWorkflowCompletionReaction(event.runId);
        });
      }
    }

    // The shared engine handles workflow selection, execution, and tracking.
    const result = await context.submit();

    if (result.status === "matched" && reactionTarget) {
      try {
        await addGitHubReaction({
          repoFullName: repo,
          reaction: "eyes",
          token: installationToken,
          target: reactionTarget
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

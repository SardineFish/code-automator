import type { IncomingMessage, ServerResponse } from "node:http";

import { verifyWebhookSignature } from "../../service/security/verify-webhook-signature.js";
import type { AppContext } from "../../types/runtime.js";
import { formatRuntimeErrorComment, formatWorkflowTerminalErrorComment } from "./github-provider-reporting.js";
import { readGitHubProviderEvent } from "./github-provider-event.js";
import {
  addGitHubReaction,
  addThreadComment,
  getHeader,
  getInstallationTokenProvider,
  readBody,
  readGitHubPullRequestLinkedIssueId,
  readPayload,
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
 *   Emitted for GitHub "issues" events when action === "opened" or "closed".
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

  const providerEvent = readGitHubProviderEvent(eventName, payload, github);
  const gateContext = providerEvent.status === "accepted" ? providerEvent.event.gate : providerEvent.gate;
  const requestLog = context.log.child({ eventName, actorLogin: gateContext?.actorLogin, repo: gateContext?.repoFullName });

  if (providerEvent.status === "ignored") {
    if (providerEvent.reason === "missing_gate_context") {
      requestLog.info({ message: "ignored delivery without gate context", reason: providerEvent.reason });
      return respond(response, 202, "Ignored");
    }

    if (providerEvent.reason === "repo_not_whitelisted" || providerEvent.reason === "actor_not_whitelisted") {
      requestLog.info({ message: "ignored delivery rejected by whitelist", reason: providerEvent.reason });
      return respond(response, 202, "Ignored");
    }

    requestLog.info({ message: "processed webhook delivery", status: "ignored", reason: providerEvent.reason });
    return respond(response, 202, "Accepted");
  }

  const providerPayload = providerEvent.event;
  const deliveryId = getHeader(request, "x-github-delivery");
  const user = providerPayload.gate.actorLogin;
  const repo = providerPayload.gate.repoFullName;
  const privateKeyPath = requireEnv(context.env, "GITHUB_APP_PRIVATE_KEY_PATH");
  const installationTokenProvider = getInstallationTokenProvider(privateKeyPath);
  const installationToken = await installationTokenProvider.createInstallationToken(
    github.clientId,
    providerPayload.gate.installationId
  );
  const linkedIssueId =
    providerPayload.kind === "pr_issue_comment" ||
    providerPayload.kind === "pr_review_comment" ||
    providerPayload.kind === "pr_review"
      ? await readGitHubPullRequestLinkedIssueId({
          repoFullName: repo,
          prId: providerPayload.prId,
          token: installationToken
        })
      : undefined;
  const triggerEnv = { GH_TOKEN: installationToken };
  const reactionTarget = providerPayload.reactionTarget;
  const reportTarget = {
    subjectId: providerPayload.threadTarget.number,
    kind: providerPayload.threadTarget.kind
  };

  function triggerWorkflow(name: Parameters<AppContext["trigger"]>[0], input: Record<string, unknown>): void {
    context.trigger(name, {
      in: {
        ...input,
        ...(deliveryId ? { deliveryId } : {}),
        installationId: providerPayload.gate.installationId
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
          providerPayload.gate.installationId
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

  context.on("error", async (event) => {
    try {
      const reportToken = await installationTokenProvider.createInstallationToken(
        github.clientId,
        providerPayload.gate.installationId
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

  try {
    if (providerPayload.kind === "issue_opened" || providerPayload.kind === "issue_closed") {
      const issueEvent = providerPayload.kind === "issue_closed" ? "issue:close" : "issue:open";

      triggerWorkflow(issueEvent, {
        event: issueEvent,
        user,
        repo,
        issueId: providerPayload.issueId,
        content: providerPayload.body
      });
    } else if (providerPayload.kind === "issue_comment") {
      if (providerPayload.mention.command) {
        triggerWorkflow(`issue:command:${providerPayload.mention.command}`, {
          event: `issue:command:${providerPayload.mention.command}`,
          user,
          repo,
          issueId: providerPayload.issueId,
          content: providerPayload.mention.content,
          command: providerPayload.mention.command
        });
      }

      if (providerPayload.mention.hasMention) {
        triggerWorkflow("issue:at", {
          event: "issue:at",
          user,
          repo,
          issueId: providerPayload.issueId,
          content: providerPayload.mention.content,
          command: providerPayload.mention.command
        });
      }

      triggerWorkflow("issue:comment", {
        event: "issue:comment",
        user,
        repo,
        issueId: providerPayload.issueId,
        content: providerPayload.mention.content,
        command: providerPayload.mention.command
      });
    } else if (providerPayload.kind === "pr_issue_comment" || providerPayload.kind === "pr_review_comment") {
      if (providerPayload.mention.hasMention) {
        triggerWorkflow("pr:at", {
          event: "pr:at",
          user,
          repo,
          issueId: linkedIssueId,
          prId: providerPayload.prId,
          content: providerPayload.mention.content
        });
      }

      triggerWorkflow("pr:comment", {
        event: "pr:comment",
        user,
        repo,
        issueId: linkedIssueId,
        prId: providerPayload.prId,
        content: providerPayload.body
      });
    } else {
      triggerWorkflow("pr:review", {
        event: "pr:review",
        user,
        repo,
        issueId: linkedIssueId,
        prId: providerPayload.prId,
        prReview: providerPayload.prReview,
        content: providerPayload.content
      });
    }

    if (reactionTarget) {
      context.on("completed", async (event) => {
        await addWorkflowCompletionReaction(event.runId);
      });
    }

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

    respond(response, 500, "Internal Server Error");
  }
}

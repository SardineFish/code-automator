import assert from "node:assert/strict";
import test from "node:test";

import { resolveGitHubProviderConfig } from "../../src/app/providers/github-config.js";
import { readGitHubProviderEvent } from "../../src/app/providers/github-provider-event.js";
import type { AppConfig } from "../../src/types/config.js";
import { createServiceConfig } from "../fixtures/service-config.js";
import {
  issueCommentPayload,
  issueOpenedPayload,
  reviewCommentPayload,
  reviewPayload
} from "../fixtures/github-webhooks.js";

test("readGitHubProviderEvent accepts issue openings with reaction and thread targets", () => {
  const result = readGitHubProviderEvent("issues", issueOpenedPayload(), createGitHubConfig());

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") {
    return;
  }

  assert.deepEqual(result.event, {
    kind: "issue_opened",
    gate: {
      repoFullName: "acme/demo",
      actorLogin: "octocat",
      installationId: 42
    },
    issueId: "7",
    body: "Need a plan",
    reactionTarget: { subjectId: 7, kind: "issue" },
    threadTarget: { number: 7, kind: "issue" }
  });
});

test("readGitHubProviderEvent accepts custom issue commands and preserves mention parsing", () => {
  const result = readGitHubProviderEvent(
    "issue_comment",
    issueCommentPayload("@github-agent-orchestrator /Ship.Release:Stable_1"),
    createGitHubConfig()
  );

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") {
    return;
  }

  assert.equal(result.event.kind, "issue_comment");
  if (result.event.kind !== "issue_comment") {
    return;
  }

  assert.equal(result.event.issueId, "7");
  assert.equal(result.event.body, "@github-agent-orchestrator /Ship.Release:Stable_1");
  assert.equal(result.event.mention.hasMention, true);
  assert.equal(result.event.mention.command, "ship.release:stable_1");
  assert.equal(result.event.mention.content, "/Ship.Release:Stable_1");
  assert.deepEqual(result.event.reactionTarget, { subjectId: 99, kind: "issue_comment" });
  assert.deepEqual(result.event.threadTarget, { number: 7, kind: "issue" });
});

test("readGitHubProviderEvent ignores plain issue comments when requireMention stays enabled", () => {
  const result = readGitHubProviderEvent("issue_comment", issueCommentPayload("please plan this"), createGitHubConfig());

  assert.deepEqual(result, {
    status: "ignored",
    gate: {
      repoFullName: "acme/demo",
      actorLogin: "octocat",
      installationId: 42
    },
    reason: "not_mentioned"
  });
});

test("readGitHubProviderEvent accepts plain issue comments when requireMention is false", () => {
  const result = readGitHubProviderEvent(
    "issue_comment",
    issueCommentPayload("please plan this"),
    createGitHubConfig((config) => {
      if (!config.gh) {
        throw new Error("Missing test GitHub config.");
      }

      config.gh.requireMention = false;
    })
  );

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") {
    return;
  }

  assert.equal(result.event.kind, "issue_comment");
  if (result.event.kind !== "issue_comment") {
    return;
  }

  assert.equal(result.event.mention.hasMention, false);
  assert.equal(result.event.mention.command, undefined);
  assert.equal(result.event.mention.content, "please plan this");
});

test("readGitHubProviderEvent accepts bare custom issue commands when requireMention is false", () => {
  const result = readGitHubProviderEvent(
    "issue_comment",
    issueCommentPayload("  /Ship.Release:Stable_1  "),
    createGitHubConfig((config) => {
      if (!config.gh) {
        throw new Error("Missing test GitHub config.");
      }

      config.gh.requireMention = false;
    })
  );

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") {
    return;
  }

  assert.equal(result.event.kind, "issue_comment");
  if (result.event.kind !== "issue_comment") {
    return;
  }

  assert.equal(result.event.mention.hasMention, false);
  assert.equal(result.event.mention.command, "ship.release:stable_1");
  assert.equal(result.event.mention.content, "/Ship.Release:Stable_1");
});

test("readGitHubProviderEvent accepts PR comments from issue-comment and review-comment payloads", () => {
  const prIssueComment = readGitHubProviderEvent(
    "issue_comment",
    issueCommentPayload("please @github-agent-orchestrator review", { pullRequest: true }),
    createGitHubConfig()
  );
  const prReviewComment = readGitHubProviderEvent(
    "pull_request_review_comment",
    reviewCommentPayload("needs work"),
    createGitHubConfig()
  );

  assert.equal(prIssueComment.status, "accepted");
  assert.equal(prReviewComment.status, "accepted");
  if (prIssueComment.status !== "accepted" || prReviewComment.status !== "accepted") {
    return;
  }

  assert.equal(prIssueComment.event.kind, "pr_issue_comment");
  assert.equal(prReviewComment.event.kind, "pr_review_comment");
  if (prIssueComment.event.kind !== "pr_issue_comment" || prReviewComment.event.kind !== "pr_review_comment") {
    return;
  }

  assert.equal(prIssueComment.event.prId, "7");
  assert.equal(prIssueComment.event.mention.hasMention, true);
  assert.equal(prReviewComment.event.prId, "8");
  assert.equal(prReviewComment.event.body, "needs work");
});

test("readGitHubProviderEvent ignores PR review comments attached to a submitted review", () => {
  const result = readGitHubProviderEvent(
    "pull_request_review_comment",
    reviewCommentPayload("please @github-agent-orchestrator review", { pullRequestReviewId: 202 }),
    createGitHubConfig()
  );

  assert.deepEqual(result, {
    status: "ignored",
    gate: {
      repoFullName: "acme/demo",
      actorLogin: "octocat",
      installationId: 42
    },
    reason: "review_comment_attached_to_review"
  });
});

test("readGitHubProviderEvent ignores approved reviews by default and accepts them when enabled", () => {
  const ignored = readGitHubProviderEvent("pull_request_review", reviewPayload("ship it", "approved"), createGitHubConfig());
  const accepted = readGitHubProviderEvent(
    "pull_request_review",
    reviewPayload("ship it", "approved"),
    createGitHubConfig((config) => {
      if (!config.gh) {
        throw new Error("Missing test GitHub config.");
      }

      config.gh.ignoreApprovalReview = false;
    })
  );

  assert.deepEqual(ignored, {
    status: "ignored",
    gate: {
      repoFullName: "acme/demo",
      actorLogin: "octocat",
      installationId: 42
    },
    reason: "approved_review_ignored"
  });
  assert.equal(accepted.status, "accepted");
  if (accepted.status !== "accepted") {
    return;
  }

  assert.equal(accepted.event.kind, "pr_review");
  if (accepted.event.kind !== "pr_review") {
    return;
  }

  assert.equal(accepted.event.prId, "8");
  assert.equal(accepted.event.prReview, "approve");
  assert.equal(accepted.event.content, "ship it");
  assert.deepEqual(accepted.event.reactionTarget, {
    subjectId: 202,
    kind: "pull_request_review",
    nodeId: "PRR_kwDOdemo202"
  });
});

test("readGitHubProviderEvent rejects missing gate context and whitelist failures", () => {
  const missingGate = readGitHubProviderEvent("issues", { action: "opened" }, createGitHubConfig());
  const whitelistRejected = readGitHubProviderEvent(
    "issue_comment",
    issueCommentPayload("@github-agent-orchestrator /approve", { senderLogin: "intruder" }),
    createGitHubConfig()
  );

  assert.deepEqual(missingGate, { status: "ignored", reason: "missing_gate_context" });
  assert.deepEqual(whitelistRejected, {
    status: "ignored",
    gate: {
      repoFullName: "acme/demo",
      actorLogin: "intruder",
      installationId: 42
    },
    reason: "actor_not_whitelisted"
  });
});

function createGitHubConfig(customizeConfig?: (config: AppConfig) => void) {
  const config = createServiceConfig();
  customizeConfig?.(config);

  if (!config.gh) {
    throw new Error("Missing test GitHub config.");
  }

  return resolveGitHubProviderConfig(config.gh);
}

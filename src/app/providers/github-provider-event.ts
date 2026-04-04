import { getWhitelistRejectionReason } from "../../service/orchestration/check-whitelist.js";
import type { WebhookGateContext } from "../../types/runtime.js";
import type { GitHubReview } from "../../types/workflow-input.js";
import type { ResolvedGitHubProviderConfig } from "./github-config.js";
import {
  type GitHubReactionTarget,
  mapReviewState,
  parseCommentMention,
  parseIssueMention,
  readGate,
  readId,
  readInteger,
  readObject,
  readString
} from "./github-utils.js";

export interface GitHubIssueThreadTarget {
  kind: "issue";
  number: number;
}

export interface GitHubPullRequestThreadTarget {
  kind: "pull_request";
  number: number;
}

export type GitHubThreadTarget =
  | GitHubIssueThreadTarget
  | GitHubPullRequestThreadTarget;

export interface GitHubIssueReactionTarget extends Extract<GitHubReactionTarget, { kind: "issue" }> {}

export interface GitHubIssueCommentReactionTarget extends Extract<GitHubReactionTarget, { kind: "issue_comment" }> {}

export interface GitHubPullRequestReviewCommentReactionTarget
  extends Extract<GitHubReactionTarget, { kind: "pull_request_review_comment" }> {}

export interface GitHubPullRequestReviewReactionTarget
  extends Extract<GitHubReactionTarget, { kind: "pull_request_review" }> {}

export interface GitHubIssueOpenedEvent {
  kind: "issue_opened";
  gate: WebhookGateContext;
  issueId: string;
  body?: string;
  reactionTarget: GitHubIssueReactionTarget;
  threadTarget: GitHubIssueThreadTarget;
}

export interface GitHubIssueClosedEvent {
  kind: "issue_closed";
  gate: WebhookGateContext;
  issueId: string;
  body?: string;
  reactionTarget: GitHubIssueReactionTarget;
  threadTarget: GitHubIssueThreadTarget;
}

export interface GitHubIssueCommentEvent {
  kind: "issue_comment";
  gate: WebhookGateContext;
  issueId: string;
  body: string;
  mention: ReturnType<typeof parseIssueMention>;
  reactionTarget?: GitHubIssueCommentReactionTarget;
  threadTarget: GitHubIssueThreadTarget;
}

export interface GitHubPullRequestIssueCommentEvent {
  kind: "pr_issue_comment";
  gate: WebhookGateContext;
  prId: string;
  body: string;
  mention: ReturnType<typeof parseCommentMention>;
  reactionTarget?: GitHubIssueCommentReactionTarget;
  threadTarget: GitHubPullRequestThreadTarget;
}

export interface GitHubPullRequestReviewCommentEvent {
  kind: "pr_review_comment";
  gate: WebhookGateContext;
  prId: string;
  body: string;
  mention: ReturnType<typeof parseCommentMention>;
  reactionTarget?: GitHubPullRequestReviewCommentReactionTarget;
  threadTarget: GitHubPullRequestThreadTarget;
}

export interface GitHubPullRequestReviewEvent {
  kind: "pr_review";
  gate: WebhookGateContext;
  prId: string;
  content: string;
  prReview?: GitHubReview;
  reviewState?: string;
  reactionTarget?: GitHubPullRequestReviewReactionTarget;
  threadTarget: GitHubPullRequestThreadTarget;
}

export type GitHubProviderEvent =
  | GitHubIssueOpenedEvent
  | GitHubIssueClosedEvent
  | GitHubIssueCommentEvent
  | GitHubPullRequestIssueCommentEvent
  | GitHubPullRequestReviewCommentEvent
  | GitHubPullRequestReviewEvent;

export type GitHubProviderEventResult =
  | { status: "accepted"; event: GitHubProviderEvent }
  | { status: "ignored"; reason: string; gate?: WebhookGateContext };

export function readGitHubProviderEvent(
  eventName: string,
  payload: Record<string, unknown>,
  github: ResolvedGitHubProviderConfig
): GitHubProviderEventResult {
  const gate = readGate(payload);

  if (!gate) {
    return { status: "ignored", reason: "missing_gate_context" };
  }

  const rejectionReason = getWhitelistRejectionReason(github.whitelist, gate);

  if (rejectionReason) {
    return { status: "ignored", gate, reason: rejectionReason };
  }

  const action = readString(payload, "action");
  const issue = readObject(payload, "issue");
  const comment = readObject(payload, "comment");
  const review = readObject(payload, "review");
  const pullRequest = readObject(payload, "pull_request");

  if (eventName === "issues" && (action === "opened" || action === "closed")) {
    const issueId = readId(issue);
    const subjectNumber = readInteger(issue ?? {}, "number");

    if (!issueId || subjectNumber === undefined) {
      return { status: "ignored", gate, reason: "invalid_delivery" };
    }

    return {
      status: "accepted",
      event: {
        kind: action === "closed" ? "issue_closed" : "issue_opened",
        gate,
        issueId,
        body: readString(issue ?? {}, "body"),
        reactionTarget: { subjectId: subjectNumber, kind: "issue" },
        threadTarget: { number: subjectNumber, kind: "issue" }
      }
    };
  }

  if (eventName === "issue_comment" && action === "created") {
    const subjectNumber = readInteger(issue ?? {}, "number");

    if (subjectNumber === undefined || !comment) {
      return { status: "ignored", gate, reason: "invalid_delivery" };
    }

    const body = readString(comment, "body") ?? "";
    const commentId = readInteger(comment, "id");

    if (readObject(issue ?? {}, "pull_request")) {
      const prId = readId(issue);

      if (!prId) {
        return { status: "ignored", gate, reason: "invalid_delivery" };
      }

      return {
        status: "accepted",
        event: {
          kind: "pr_issue_comment",
          gate,
          prId,
          body,
          mention: parseCommentMention(body, github.botHandle),
          reactionTarget: commentId === undefined ? undefined : { subjectId: commentId, kind: "issue_comment" },
          threadTarget: { number: subjectNumber, kind: "pull_request" }
        }
      };
    }

    const issueId = readId(issue);

    if (!issueId) {
      return { status: "ignored", gate, reason: "invalid_delivery" };
    }

    if (readString(issue ?? {}, "state") === "closed") {
      return { status: "ignored", gate, reason: "issue_closed" };
    }

    const mention = parseIssueMention(body, github.botHandle, github.requireMention);

    if (!mention.hasMention && github.requireMention) {
      return { status: "ignored", gate, reason: "not_mentioned" };
    }

    return {
      status: "accepted",
      event: {
        kind: "issue_comment",
        gate,
        issueId,
        body,
        mention,
        reactionTarget: commentId === undefined ? undefined : { subjectId: commentId, kind: "issue_comment" },
        threadTarget: { number: subjectNumber, kind: "issue" }
      }
    };
  }

  if (eventName === "pull_request_review_comment" && action === "created") {
    const prId = readId(pullRequest);
    const subjectNumber = readInteger(pullRequest ?? {}, "number");

    if (!prId || subjectNumber === undefined || !comment) {
      return { status: "ignored", gate, reason: "invalid_delivery" };
    }

    const body = readString(comment, "body") ?? "";
    const commentId = readInteger(comment, "id");

    return {
      status: "accepted",
      event: {
        kind: "pr_review_comment",
        gate,
        prId,
        body,
        mention: parseCommentMention(body, github.botHandle),
        reactionTarget:
          commentId === undefined ? undefined : { subjectId: commentId, kind: "pull_request_review_comment" },
        threadTarget: { number: subjectNumber, kind: "pull_request" }
      }
    };
  }

  if (eventName === "pull_request_review") {
    const prId = readId(pullRequest);
    const subjectNumber = readInteger(pullRequest ?? {}, "number");

    if (!prId || subjectNumber === undefined || !review) {
      return { status: "ignored", gate, reason: "invalid_delivery" };
    }

    const reviewState = readString(review, "state");

    if (reviewState === "approved" && github.ignoreApprovalReview) {
      return { status: "ignored", gate, reason: "approved_review_ignored" };
    }

    const prReview = mapReviewState(reviewState);
    const reviewId = readInteger(review, "id");
    const reviewNodeId = readString(review, "node_id");

    return {
      status: "accepted",
      event: {
        kind: "pr_review",
        gate,
        prId,
        content: readString(review, "body")?.trim() || prReview || reviewState || "",
        prReview,
        reviewState,
        reactionTarget:
          reviewId === undefined || !reviewNodeId
            ? undefined
            : {
                subjectId: reviewId,
                kind: "pull_request_review",
                nodeId: reviewNodeId
              },
        threadTarget: { number: subjectNumber, kind: "pull_request" }
      }
    };
  }

  return { status: "ignored", gate, reason: "unsupported_event" };
}

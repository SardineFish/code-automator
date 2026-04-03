import { getWhitelistRejectionReason } from "../../service/orchestration/check-whitelist.js";
import type { WebhookGateContext } from "../../types/runtime.js";
import type { TriggerKey } from "../../types/triggers.js";
import { type ResolvedGitHubProviderConfig } from "./github-config.js";
import { mapReviewState, parseIssueMention } from "./github-utils.js";

export interface GitHubDeliveryPayload {
  action?: string;
  comment?: { body?: string; id?: number };
  installation?: { id?: number };
  issue?: { body?: string; id?: string; isPullRequest: boolean; number?: number };
  pullRequest?: { id?: string; number?: number };
  repository?: { fullName?: string };
  review?: { body?: string; state?: string };
  sender?: { login?: string };
}

export interface GitHubDeliveryTrigger {
  input: Record<string, unknown>;
  name: TriggerKey;
}

export interface GitHubRelevantDelivery {
  gate: WebhookGateContext;
  reactionTarget?: GitHubReactionTarget;
  threadTarget?: GitHubThreadTarget;
  triggers: GitHubDeliveryTrigger[];
}

export interface GitHubReactionTarget {
  kind: "issue" | "issue_comment" | "pull_request_review_comment";
  subjectId: number;
}

export interface GitHubThreadTarget {
  kind: "issue" | "pull_request";
  number: number;
}

export type GitHubDeliveryEvaluation =
  | { gate?: WebhookGateContext; reason: string; status: "ignored" }
  | { delivery: GitHubRelevantDelivery; status: "relevant" };

export function evaluateGitHubDelivery(
  eventName: string,
  payload: GitHubDeliveryPayload,
  github: ResolvedGitHubProviderConfig
): GitHubDeliveryEvaluation {
  const gate = readDeliveryGate(payload);

  if (!gate) {
    return { status: "ignored", reason: "missing_gate_context" };
  }

  const rejectionReason = getWhitelistRejectionReason(github.whitelist, gate);
  if (rejectionReason) {
    return { status: "ignored", gate, reason: rejectionReason };
  }

  const user = gate.actorLogin;
  const repo = gate.repoFullName;
  const issue = payload.issue;
  const comment = payload.comment;
  const pullRequest = payload.pullRequest;
  const review = payload.review;

  if (eventName === "issues" && payload.action === "opened" && issue?.number !== undefined) {
    return {
      status: "relevant",
      delivery: {
        gate,
        reactionTarget: { subjectId: issue.number, kind: "issue" },
        threadTarget: { number: issue.number, kind: "issue" },
        triggers: [
          {
            name: "issue:open",
            input: {
              event: "issue:open",
              user,
              repo,
              issueId: issue.id,
              content: issue.body
            }
          }
        ]
      }
    };
  }

  if (eventName === "issue_comment" && payload.action === "created" && issue?.id && issue.number !== undefined && comment) {
    const content = comment.body ?? "";

    if (issue.isPullRequest) {
      return {
        status: "relevant",
        delivery: {
          gate,
          reactionTarget: readReactionTarget(comment.id, "issue_comment"),
          threadTarget: { number: issue.number, kind: "pull_request" },
          triggers: [
            {
              name: "pr:comment",
              input: {
                event: "pr:comment",
                user,
                repo,
                prId: issue.id,
                content
              }
            }
          ]
        }
      };
    }

    const mention = parseIssueMention(content, github.botHandle);
    if (!mention.hasMention) {
      return { status: "ignored", gate, reason: "not_mentioned" };
    }

    const triggers: GitHubDeliveryTrigger[] = [];

    if (mention.command) {
      triggers.push({
        name: `issue:command:${mention.command}`,
        input: {
          event: `issue:command:${mention.command}`,
          user,
          repo,
          issueId: issue.id,
          content: mention.content,
          command: mention.command
        }
      });
    }

    triggers.push({
      name: "issue:comment",
      input: {
        event: "issue:comment",
        user,
        repo,
        issueId: issue.id,
        content: mention.content,
        command: mention.command
      }
    });

    return {
      status: "relevant",
      delivery: {
        gate,
        reactionTarget: readReactionTarget(comment.id, "issue_comment"),
        threadTarget: { number: issue.number, kind: "issue" },
        triggers
      }
    };
  }

  if (
    eventName === "pull_request_review_comment" &&
    payload.action === "created" &&
    pullRequest?.id &&
    pullRequest.number !== undefined &&
    comment
  ) {
    return {
      status: "relevant",
      delivery: {
        gate,
        reactionTarget: readReactionTarget(comment.id, "pull_request_review_comment"),
        threadTarget: { number: pullRequest.number, kind: "pull_request" },
        triggers: [
          {
            name: "pr:comment",
            input: {
              event: "pr:comment",
              user,
              repo,
              prId: pullRequest.id,
              content: comment.body
            }
          }
        ]
      }
    };
  }

  if (eventName === "pull_request_review" && pullRequest?.id && pullRequest.number !== undefined && review) {
    const reviewState = review.state;
    const prReview = mapReviewState(reviewState);

    return {
      status: "relevant",
      delivery: {
        gate,
        threadTarget: { number: pullRequest.number, kind: "pull_request" },
        triggers: [
          {
            name: "pr:review",
            input: {
              event: "pr:review",
              user,
              repo,
              prId: pullRequest.id,
              prReview,
              content: review.body?.trim() || prReview || reviewState
            }
          }
        ]
      }
    };
  }

  return { status: "ignored", gate, reason: "unsupported_event" };
}

export function normalizeGitHubDeliveryPayload(payload: Record<string, unknown>): GitHubDeliveryPayload {
  const repository = readNestedObject(payload, "repository");
  const sender = readNestedObject(payload, "sender");
  const installation = readNestedObject(payload, "installation");
  const issue = readNestedObject(payload, "issue");
  const comment = readNestedObject(payload, "comment");
  const pullRequest = readNestedObject(payload, "pull_request");
  const review = readNestedObject(payload, "review");

  return {
    action: readString(payload, "action"),
    repository: repository ? { fullName: readString(repository, "full_name") } : undefined,
    sender: sender ? { login: readString(sender, "login") } : undefined,
    installation: installation ? { id: readInteger(installation, "id") } : undefined,
    issue: issue
      ? {
          body: readString(issue, "body"),
          id: readNumericId(issue),
          isPullRequest: Boolean(readNestedObject(issue, "pull_request")),
          number: readInteger(issue, "number")
        }
      : undefined,
    comment: comment
      ? {
          body: readString(comment, "body"),
          id: readInteger(comment, "id")
        }
      : undefined,
    pullRequest: pullRequest
      ? {
          id: readNumericId(pullRequest),
          number: readInteger(pullRequest, "number")
        }
      : undefined,
    review: review
      ? {
          body: readString(review, "body"),
          state: readString(review, "state")
        }
      : undefined
  };
}

function readDeliveryGate(payload: GitHubDeliveryPayload): WebhookGateContext | undefined {
  const repoFullName = payload.repository?.fullName;
  const actorLogin = payload.sender?.login;
  const installationId = payload.installation?.id;

  return repoFullName && actorLogin && installationId !== undefined
    ? { repoFullName, actorLogin, installationId }
    : undefined;
}

function readNestedObject(
  value: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const field = value[key];
  return typeof field === "object" && field !== null && !Array.isArray(field)
    ? (field as Record<string, unknown>)
    : undefined;
}

function readInteger(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  return typeof field === "number" && Number.isInteger(field) ? field : undefined;
}

function readNumericId(value: Record<string, unknown>): string | undefined {
  const number = readInteger(value, "number");
  return number === undefined ? undefined : String(number);
}

function readReactionTarget(
  subjectId: number | undefined,
  kind: GitHubReactionTarget["kind"]
): GitHubReactionTarget | undefined {
  return subjectId === undefined ? undefined : { subjectId, kind };
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

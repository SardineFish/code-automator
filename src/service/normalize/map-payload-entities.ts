import type {
  CommentInput,
  PullRequestInput,
  ReviewInput,
  SubjectInput,
  WorkflowTemplateInput
} from "../../types/workflow-input.js";
import { readInteger, readObject, readString } from "./payload-readers.js";

export function readIssueSubject(
  issue: Record<string, unknown> | null,
  kind: "issue" | "pull_request"
): SubjectInput | null {
  if (!issue) {
    return null;
  }

  const number = readInteger(issue, "number");
  if (number === undefined) {
    return null;
  }

  const user = readObject(issue, "user");

  return {
    kind,
    number,
    title: readString(issue, "title"),
    body: readString(issue, "body"),
    state: readString(issue, "state"),
    url: readString(issue, "html_url") ?? readString(issue, "url"),
    authorLogin: user ? readString(user, "login") : undefined
  };
}

export function mapIssue(issue: Record<string, unknown>): WorkflowTemplateInput["issue"] {
  return {
    number: readInteger(issue, "number") ?? 0,
    title: readString(issue, "title"),
    body: readString(issue, "body"),
    state: readString(issue, "state"),
    url: readString(issue, "html_url") ?? readString(issue, "url")
  };
}

export function mapPullRequestFromIssue(issue: Record<string, unknown>): PullRequestInput {
  return {
    number: readInteger(issue, "number") ?? 0,
    title: readString(issue, "title"),
    body: readString(issue, "body"),
    state: readString(issue, "state"),
    url: readString(issue, "html_url") ?? readString(issue, "url")
  };
}

export function mapPullRequest(pullRequest: Record<string, unknown> | null): PullRequestInput | null {
  if (!pullRequest) {
    return null;
  }

  const number = readInteger(pullRequest, "number");
  if (number === undefined) {
    return null;
  }

  return {
    number,
    title: readString(pullRequest, "title"),
    body: readString(pullRequest, "body"),
    state: readString(pullRequest, "state"),
    url: readString(pullRequest, "html_url") ?? readString(pullRequest, "url")
  };
}

export function mapComment(comment: Record<string, unknown> | null): CommentInput | null {
  if (!comment) {
    return null;
  }

  return {
    id: readInteger(comment, "id"),
    body: readString(comment, "body"),
    url: readString(comment, "html_url") ?? readString(comment, "url")
  };
}

export function mapReview(review: Record<string, unknown> | null): ReviewInput | null {
  if (!review) {
    return null;
  }

  return {
    id: readInteger(review, "id"),
    body: readString(review, "body"),
    state: readString(review, "state"),
    url: readString(review, "html_url") ?? readString(review, "url")
  };
}

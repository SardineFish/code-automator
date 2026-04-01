import type { NormalizedWebhookEvent } from "../../types/runtime.js";
import { asObject, readString } from "./payload-readers.js";
import { normalizeIssueComment, normalizeOpenedIssue } from "./normalize-issue-events.js";
import { normalizeReview, normalizeReviewComment } from "./normalize-pull-request-events.js";
import { readCommonContext } from "./read-common-context.js";

export interface NormalizeWebhookInput {
  eventName: string;
  deliveryId?: string;
  payload: unknown;
  botHandle: string;
}

export function normalizeWebhookEvent(input: NormalizeWebhookInput): NormalizedWebhookEvent | null {
  const payload = asObject(input.payload);
  if (!payload) {
    return null;
  }

  const common = readCommonContext(payload);
  if (!common) {
    return null;
  }

  if (input.eventName === "issues" && readString(payload, "action") === "opened") {
    return normalizeOpenedIssue(input, payload, common);
  }

  if (input.eventName === "issue_comment" && readString(payload, "action") === "created") {
    return normalizeIssueComment(input, payload, common);
  }

  if (
    input.eventName === "pull_request_review_comment" &&
    readString(payload, "action") === "created"
  ) {
    return normalizeReviewComment(input, payload, common);
  }

  if (input.eventName === "pull_request_review") {
    return normalizeReview(input, payload, common);
  }

  return null;
}

export function extractWebhookGateContext(payload: unknown) {
  const objectValue = asObject(payload);
  if (!objectValue) {
    return null;
  }

  const common = readCommonContext(objectValue);
  return common?.gate ?? null;
}

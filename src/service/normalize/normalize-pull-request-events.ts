import type { NormalizedWebhookEvent } from "../../types/runtime.js";
import { buildNormalizedEvent } from "./build-normalized-event.js";
import { mapComment, mapPullRequest, mapReview } from "./map-payload-entities.js";
import { readObject, readString } from "./payload-readers.js";
import type { CommonContext } from "./read-common-context.js";
import type { NormalizeWebhookInput } from "./normalize-webhook-event.js";

export function normalizeReviewComment(
  input: NormalizeWebhookInput,
  payload: Record<string, unknown>,
  common: CommonContext
): NormalizedWebhookEvent | null {
  const pullRequest = mapPullRequest(readObject(payload, "pull_request"));
  const comment = mapComment(readObject(payload, "comment"));

  if (!pullRequest || !comment) {
    return null;
  }

  return buildNormalizedEvent(
    input,
    common,
    ["pr:comment"],
    { ...pullRequest, kind: "pull_request", authorLogin: undefined },
    { pullRequest, comment },
    comment.body ?? ""
  );
}

export function normalizeReview(
  input: NormalizeWebhookInput,
  payload: Record<string, unknown>,
  common: CommonContext
): NormalizedWebhookEvent | null {
  const action = readString(payload, "action");

  if (action !== "submitted" && action !== "edited" && action !== "dismissed") {
    return null;
  }

  const pullRequest = mapPullRequest(readObject(payload, "pull_request"));
  const review = mapReview(readObject(payload, "review"));

  if (!pullRequest || !review) {
    return null;
  }

  const content = review.body && review.body.trim() !== "" ? review.body : review.state ?? "";

  return buildNormalizedEvent(
    input,
    common,
    ["pr:review"],
    { ...pullRequest, kind: "pull_request", authorLogin: undefined },
    { pullRequest, review },
    content
  );
}

import { clipLogPreview } from "../../service/logging/log-preview.js";
import type { NormalizedWebhookEvent } from "../../types/runtime.js";

export function buildDebugContentFields(normalized: NormalizedWebhookEvent): Record<string, unknown> | null {
  const fields: Record<string, unknown> = {};
  const commentBody = normalized.input.comment?.body?.trim();
  const reviewBody = normalized.input.review?.body?.trim();
  const normalizedContent = normalized.input.content.trim();

  if (commentBody) {
    fields.commentBodyPreview = clipLogPreview(commentBody);
  }
  if (reviewBody) {
    fields.reviewBodyPreview = clipLogPreview(reviewBody);
  }
  if (normalizedContent) {
    fields.contentPreview = clipLogPreview(normalizedContent);
  }
  if (normalized.input.review?.state) {
    fields.reviewState = normalized.input.review.state;
  }
  if (normalized.input.command?.name) {
    fields.commandName = normalized.input.command.name;
  }
  if (normalized.input.subject.kind) {
    fields.subjectKind = normalized.input.subject.kind;
  }
  fields.subjectNumber = normalized.input.subject.number;

  return Object.keys(fields).length > 2 ? fields : null;
}

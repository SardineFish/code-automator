import type { TriggerKey } from "../../types/triggers.js";
import type { NormalizedWebhookEvent } from "../../types/runtime.js";
import { buildNormalizedEvent } from "./build-normalized-event.js";
import { mapComment, mapIssue, mapPullRequestFromIssue, readIssueSubject } from "./map-payload-entities.js";
import { readObject, readString } from "./payload-readers.js";
import { parseIssueMention } from "./parse-issue-command.js";
import type { CommonContext } from "./read-common-context.js";
import type { NormalizeWebhookInput } from "./normalize-webhook-event.js";

export function normalizeOpenedIssue(
  input: NormalizeWebhookInput,
  payload: Record<string, unknown>,
  common: CommonContext
): NormalizedWebhookEvent | null {
  const issue = readObject(payload, "issue");
  const subject = readIssueSubject(issue, "issue");

  if (!issue || !subject) {
    return null;
  }

  return buildNormalizedEvent(input, common, ["issue:open"], subject, { issue: mapIssue(issue) }, subject.body ?? "");
}

export function normalizeIssueComment(
  input: NormalizeWebhookInput,
  payload: Record<string, unknown>,
  common: CommonContext
): NormalizedWebhookEvent | null {
  const issue = readObject(payload, "issue");
  const comment = mapComment(readObject(payload, "comment"));

  if (!issue || !comment) {
    return null;
  }

  const isPullRequestComment = readObject(issue, "pull_request") !== null;
  const subject = readIssueSubject(issue, isPullRequestComment ? "pull_request" : "issue");

  if (!subject) {
    return null;
  }

  if (isPullRequestComment) {
    return buildNormalizedEvent(
      input,
      common,
      ["pr:comment"],
      subject,
      { issue: mapIssue(issue), comment, pullRequest: mapPullRequestFromIssue(issue) },
      comment.body ?? readString(issue, "body") ?? ""
    );
  }

  const parsed = parseIssueMention(comment.body ?? "", input.botHandle);
  if (!parsed.hasMention) {
    return null;
  }

  const candidateTriggers: TriggerKey[] = parsed.command
    ? [`issue:command:${parsed.command.name}`, "issue:comment"]
    : ["issue:comment"];

  return buildNormalizedEvent(
    input,
    common,
    candidateTriggers,
    subject,
    { issue: mapIssue(issue), comment, command: parsed.command },
    parsed.content
  );
}

import assert from "node:assert/strict";
import test from "node:test";

import { extractWebhookGateContext, normalizeWebhookEvent } from "../../../src/service/normalize/normalize-webhook-event.js";
import {
  issueCommentPayload,
  issueOpenedPayload,
  reviewCommentPayload,
  reviewPayload
} from "../../fixtures/github-webhooks.js";

test("normalizeWebhookEvent maps issue opened events", () => {
  const normalized = normalizeWebhookEvent({
    eventName: "issues",
    deliveryId: "delivery-1",
    payload: issueOpenedPayload(),
    botHandle: "github-agent-orchestrator"
  });

  assert.ok(normalized);
  assert.deepEqual(normalized.candidateTriggers, ["issue:open"]);
  assert.equal(normalized.input.repo, "acme/demo");
  assert.equal(normalized.input.subjectNumber, 7);
  assert.equal(normalized.input.subjectKind, "issue");
});

test("normalizeWebhookEvent maps issue commands and aliases", () => {
  const normalized = normalizeWebhookEvent({
    eventName: "issue_comment",
    payload: issueCommentPayload("@github-agent-orchestrator /plan now"),
    botHandle: "github-agent-orchestrator"
  });

  assert.ok(normalized);
  assert.deepEqual(normalized.candidateTriggers, ["issue:command:plan", "issue:comment"]);
  assert.equal(normalized.input.commandName, "plan");
  assert.equal(normalized.input.content, "/plan now");
});

test("normalizeWebhookEvent maps PR issue comments without requiring a mention", () => {
  const normalized = normalizeWebhookEvent({
    eventName: "issue_comment",
    payload: issueCommentPayload("looks good", { pullRequest: true }),
    botHandle: "github-agent-orchestrator"
  });

  assert.ok(normalized);
  assert.deepEqual(normalized.candidateTriggers, ["pr:comment"]);
  assert.equal(normalized.input.prNumber, 7);
  assert.equal(normalized.input.content, "looks good");
});

test("normalizeWebhookEvent uses review state when the review body is empty", () => {
  const normalized = normalizeWebhookEvent({
    eventName: "pull_request_review",
    payload: reviewPayload("", "changes_requested"),
    botHandle: "github-agent-orchestrator"
  });

  assert.ok(normalized);
  assert.deepEqual(normalized.candidateTriggers, ["pr:review"]);
  assert.equal(normalized.input.content, "changes_requested");
  assert.equal(normalized.input.reviewState, "changes_requested");
});

test("extractWebhookGateContext returns repo and actor gating data", () => {
  const gate = extractWebhookGateContext(reviewCommentPayload("needs work"));

  assert.deepEqual(gate, {
    repoFullName: "acme/demo",
    actorLogin: "octocat",
    installationId: 42
  });
});

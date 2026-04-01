import assert from "node:assert/strict";
import test from "node:test";

import { parseIssueMention } from "../../../src/service/normalize/parse-issue-command.js";

test("parseIssueMention recognizes slash commands", () => {
  const result = parseIssueMention("@github-agent-orchestrator /plan now", "github-agent-orchestrator");

  assert.equal(result.hasMention, true);
  assert.equal(result.command?.name, "plan");
  assert.equal(result.command?.invokedWithSlash, true);
  assert.equal(result.command?.argsText, "now");
});

test("parseIssueMention treats unknown commands as generic mention content", () => {
  const result = parseIssueMention("@github-agent-orchestrator deploy now", "github-agent-orchestrator");

  assert.equal(result.hasMention, true);
  assert.equal(result.command, undefined);
  assert.equal(result.content, "deploy now");
});

test("parseIssueMention ignores comments without a leading mention", () => {
  const result = parseIssueMention("please plan this", "github-agent-orchestrator");

  assert.equal(result.hasMention, false);
  assert.equal(result.content, "please plan this");
});

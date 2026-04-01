import assert from "node:assert/strict";
import test from "node:test";

import { selectWorkflow } from "../../../src/service/workflow/select-workflow.js";
import { createServiceConfig } from "../../fixtures/service-config.js";

test("selectWorkflow respects YAML declaration order", () => {
  const selection = selectWorkflow(createServiceConfig().workflow, [
    "issue:command:plan",
    "issue:comment"
  ]);

  assert.equal(selection?.workflow.name, "issue-plan");
  assert.equal(selection?.matchedTrigger, "issue:command:plan");
});

test("selectWorkflow returns null when nothing matches", () => {
  assert.equal(selectWorkflow(createServiceConfig().workflow, ["issue:command:unknown"]), null);
});

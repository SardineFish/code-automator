import assert from "node:assert/strict";
import test from "node:test";

import type { WorkflowInput } from "../../../src/types/workflow-input.js";
import {
  renderExecutorCommand,
  renderWorkflowPrompt
} from "../../../src/service/template/render-workflow-template.js";

const templateInput: WorkflowInput = {
  event: "issue:comment",
  issueId: "7",
  user: "octocat",
  content: "@bot plan this",
  command: "plan",
  meta: {
    source: "github",
    body: "@bot plan this"
  }
};

test("renderWorkflowPrompt resolves aliases and structured paths", () => {
  const rendered = renderWorkflowPrompt(
    "Issue ${in.issueId} by ${in.user}: ${in.meta.body}",
    { in: templateInput }
  );

  assert.equal(rendered, "Issue 7 by octocat: @bot plan this");
});

test("renderWorkflowPrompt renders objects as compact JSON", () => {
  const rendered = renderWorkflowPrompt("Meta JSON ${in.meta}", { in: templateInput });
  assert.equal(
    rendered,
    'Meta JSON {"source":"github","body":"@bot plan this"}'
  );
});

test("renderWorkflowPrompt renders null values as empty string", () => {
  const inputWithNull = {
    ...templateInput,
    meta: { ...templateInput.meta as Record<string, unknown>, body: null }
  };
  const rendered = renderWorkflowPrompt("Body ${in.meta.body}", { in: inputWithNull });
  assert.equal(rendered, "Body ");
});

test("renderWorkflowPrompt rejects missing path segments", () => {
  assert.throws(() => renderWorkflowPrompt("Missing ${in.meta.missing}", { in: templateInput }), {
    name: "TemplateRenderError",
    message: /Template variable 'in\.meta\.missing': Missing value at 'missing'\./
  });
});

test("renderExecutorCommand resolves prompt and workspace variables", () => {
  const command = renderExecutorCommand("codex -w ${workspace} exec ${prompt}", {
    prompt: "Analyze issue",
    workspace: "/tmp/workspace-1"
  });

  assert.equal(command, "codex -w /tmp/workspace-1 exec Analyze issue");
});

test("renderExecutorCommand rejects unsupported roots", () => {
  assert.throws(
    () => renderExecutorCommand("echo ${in.issueId}", { prompt: "x", workspace: "" }),
    {
      name: "TemplateRenderError",
      message: /Unsupported root 'in'/
    }
  );
});

test("renderWorkflowPrompt rejects prototype-chain properties", () => {
  assert.throws(
    () => renderWorkflowPrompt("Ctor ${in.meta.constructor}", { in: templateInput }),
    {
      name: "TemplateRenderError",
      message: /Template variable 'in\.meta\.constructor': Missing value at 'constructor'\./
    }
  );
});

test("renderWorkflowPrompt rejects unsupported rendered values", () => {
  const inputWithFunction = {
    ...templateInput,
    meta: {
      ...(templateInput.meta as Record<string, unknown>),
      unsafe: () => "nope"
    }
  } as WorkflowInput;

  assert.throws(
    () => renderWorkflowPrompt("Unsafe ${in.meta.unsafe}", { in: inputWithFunction }),
    {
      name: "TemplateRenderError",
      message: /Template variable 'in\.meta\.unsafe': Unsupported value type\./
    }
  );
});

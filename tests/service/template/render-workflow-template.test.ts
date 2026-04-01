import assert from "node:assert/strict";
import test from "node:test";

import type { WorkflowTemplateInput } from "../../../src/types/workflow-input.js";
import {
  renderExecutorCommand,
  renderWorkflowPrompt
} from "../../../src/service/template/render-workflow-template.js";

const templateInput: WorkflowTemplateInput = {
  event: { name: "issue_comment", action: "created", deliveryId: "abc-123" },
  repository: { owner: "acme", name: "demo", fullName: "acme/demo" },
  actor: { login: "octocat", id: 1 },
  installation: { id: 42 },
  subject: { kind: "issue", number: 7, title: "Fix crash", body: "Details" },
  message: { text: "@bot plan this" },
  comment: { body: "@bot plan this" },
  repo: "acme/demo",
  repoOwner: "acme",
  repoName: "demo",
  actorLogin: "octocat",
  content: "@bot plan this",
  subjectKind: "issue",
  subjectNumber: 7,
  subjectTitle: "Fix crash",
  subjectBody: "Details",
  subjectUrl: "https://example.test/issues/7",
  issueNumber: 7,
  commentBody: "@bot plan this",
  eventName: "issue_comment",
  eventAction: "created"
};

test("renderWorkflowPrompt resolves aliases and structured paths", () => {
  const rendered = renderWorkflowPrompt(
    "Issue ${in.subjectNumber} in ${in.repo} by ${in.actor.login}: ${in.comment.body}",
    { in: templateInput }
  );

  assert.equal(rendered, "Issue 7 in acme/demo by octocat: @bot plan this");
});

test("renderWorkflowPrompt renders objects as compact JSON", () => {
  const rendered = renderWorkflowPrompt("Repo JSON ${in.repository}", { in: templateInput });
  assert.equal(
    rendered,
    'Repo JSON {"owner":"acme","name":"demo","fullName":"acme/demo"}'
  );
});

test("renderWorkflowPrompt renders null values as empty string", () => {
  const inputWithNull = {
    ...templateInput,
    subject: { ...templateInput.subject, body: null as unknown as string }
  };
  const rendered = renderWorkflowPrompt("Body ${in.subject.body}", { in: inputWithNull });
  assert.equal(rendered, "Body ");
});

test("renderWorkflowPrompt rejects missing path segments", () => {
  assert.throws(() => renderWorkflowPrompt("Missing ${in.review.state}", { in: templateInput }), {
    name: "TemplateRenderError",
    message: /Template variable 'in\.review\.state': Missing value at 'review'\./
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
    () => renderExecutorCommand("echo ${in.repo}", { prompt: "x", workspace: "" }),
    {
      name: "TemplateRenderError",
      message: /Unsupported root 'in'/
    }
  );
});

test("renderWorkflowPrompt rejects prototype-chain properties", () => {
  assert.throws(
    () => renderWorkflowPrompt("Ctor ${in.repository.constructor}", { in: templateInput }),
    {
      name: "TemplateRenderError",
      message: /Template variable 'in\.repository\.constructor': Missing value at 'constructor'\./
    }
  );
});

test("renderWorkflowPrompt rejects unsupported rendered values", () => {
  const inputWithFunction = {
    ...templateInput,
    repository: {
      ...templateInput.repository,
      unsafe: () => "nope"
    }
  } as unknown as WorkflowTemplateInput;

  assert.throws(
    () => renderWorkflowPrompt("Unsafe ${in.repository.unsafe}", { in: inputWithFunction }),
    {
      name: "TemplateRenderError",
      message: /Template variable 'in\.repository\.unsafe': Unsupported value type\./
    }
  );
});

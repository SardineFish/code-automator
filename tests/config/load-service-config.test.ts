import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { ConfigError } from "../../src/config/config-error.js";
import { parseServiceConfig } from "../../src/config/load-service-config.js";
import { renderWorkflowPrompt } from "../../src/service/template/render-workflow-template.js";

const validConfig = `
server:
  host: 0.0.0.0
  port: 3000
tracking:
  stateFile: state.json
  logFile: runs.jsonl
workspace:
  enabled: false
  baseDir: /tmp/gao
  cleanupAfterRun: false
gh:
  url: /gh-hook
  clientId: app-client-id
  appId: 123456
  botHandle: github-agent-orchestrator
  whitelist:
    user:
      - octocat
    repo:
      - acme/demo
chat-bot:
  url: /chat
executors:
  codex:
    run: codex exec \${prompt}
    timeoutMs: 900000
    env:
      FOO: BAR
  claude:
    run: claude run \${prompt}
workflow:
  issue-plan:
    on:
      - issue:open
      - issue:command:plan
    use: codex
    prompt: Plan issue \${in.issueId}
  issue-at:
    on:
      - issue:at
    use: claude
    prompt: Handle request \${in.content}
`;

test("parseServiceConfig returns ordered workflows and typed config", () => {
  const parsed = parseServiceConfig(validConfig, "/tmp/configs/test.yml");

  assert.equal(parsed.configDir, "/tmp/configs");
  assert.equal(parsed.logging.level, "info");
  assert.equal(parsed.workspace.baseDir, "/tmp/gao");
  assert.equal(parsed.tracking.stateFile, "/tmp/configs/state.json");
  assert.equal(parsed.tracking.logFile, "/tmp/configs/runs.jsonl");
  assert.equal(parsed.workflow[0].name, "issue-plan");
  assert.equal(parsed.workflow[1].name, "issue-at");
  assert.deepEqual(parsed.executors.codex.env, { FOO: "BAR" });
  assert.equal(parsed.executors.codex.timeoutMs, 900000);
  assert.deepEqual(parsed.gh, {
    url: "/gh-hook",
    clientId: "app-client-id",
    appId: 123456,
    botHandle: "github-agent-orchestrator",
    whitelist: {
      user: ["octocat"],
      repo: ["acme/demo"]
    }
  });
  assert.deepEqual(parsed["chat-bot"], { url: "/chat" });
});

test("parseServiceConfig accepts an explicit logging level", () => {
  const parsed = parseServiceConfig(
    `${validConfig}\nlogging:\n  level: debug`,
    "/tmp/configs/test.yml"
  );

  assert.equal(parsed.logging.level, "debug");
});

test("parseServiceConfig accepts executor workspace overrides", () => {
  const parsed = parseServiceConfig(
    validConfig
      .replace("    timeoutMs: 900000", "    timeoutMs: 900000\n    workspace: /tmp/codex-workspaces")
      .replace("    run: claude run ${prompt}", "    run: claude run ${prompt}\n    workspace: false"),
    "/tmp/configs/test.yml"
  );

  assert.equal(parsed.executors.codex.workspace, "/tmp/codex-workspaces");
  assert.equal(parsed.executors.claude.workspace, false);
});

test("parseServiceConfig resolves relative workspace directories from the config file location", () => {
  const parsed = parseServiceConfig(
    validConfig
      .replace("baseDir: /tmp/gao", "baseDir: .runtime/workspaces")
      .replace("    timeoutMs: 900000", "    timeoutMs: 900000\n    workspace: .runtime/issues")
      .replace(
        "    run: claude run ${prompt}",
        "    run: claude run ${prompt}\n    workspace:\n      baseDir: .runtime/pull-requests\n      key: ${in.repo}#${in.issueId}"
      ),
    "/tmp/configs/test.yml"
  );

  assert.equal(parsed.workspace.baseDir, "/tmp/configs/.runtime/workspaces");
  assert.equal(parsed.executors.codex.workspace, "/tmp/configs/.runtime/issues");
  assert.deepEqual(parsed.executors.claude.workspace, {
    baseDir: "/tmp/configs/.runtime/pull-requests",
    key: "${in.repo}#${in.issueId}"
  });
});

test("parseServiceConfig accepts executor workspace key mappings", () => {
  const parsed = parseServiceConfig(
    validConfig.replace(
      "    timeoutMs: 900000",
      "    timeoutMs: 900000\n    workspace:\n      baseDir: /tmp/codex-workspaces\n      key: ${in.repo}#${in.issueId}"
    ),
    "/tmp/configs/test.yml"
  );

  assert.deepEqual(parsed.executors.codex.workspace, {
    baseDir: "/tmp/codex-workspaces",
    key: "${in.repo}#${in.issueId}"
  });
});

test("parseServiceConfig expands workflow prompt file includes and keeps nested runtime variables", (t) => {
  const dir = createPromptFixture(t, {
    "prompts/issue-plan.txt": "Plan issue ${in.issueId}\n${file:partials/repo.txt}",
    "prompts/partials/repo.txt": "Repo ${in.repo}"
  });
  const parsed = parseServiceConfig(
    validConfig.replace("prompt: Plan issue ${in.issueId}", 'prompt: "${file: prompts/issue-plan.txt}"'),
    path.join(dir, "service.yml")
  );

  assert.equal(parsed.workflow[0].prompt, "Plan issue ${in.issueId}\nRepo ${in.repo}");
  assert.equal(
    renderWorkflowPrompt(parsed.workflow[0].prompt, {
      in: {
        issueId: "7",
        repo: "acme/demo"
      }
    }),
    "Plan issue 7\nRepo acme/demo"
  );
});

test("parseServiceConfig accepts absolute workflow prompt include paths", (t) => {
  const dir = createPromptFixture(t, {
    "prompts/issue-plan.txt": "Plan issue ${in.issueId}"
  });
  const absolutePromptPath = path.join(dir, "prompts/issue-plan.txt");
  const parsed = parseServiceConfig(
    validConfig.replace("prompt: Plan issue ${in.issueId}", `prompt: "\${file:${absolutePromptPath}}"`),
    path.join(dir, "service.yml")
  );

  assert.equal(parsed.workflow[0].prompt, "Plan issue ${in.issueId}");
});

test("parseServiceConfig rejects missing workflow prompt include files", (t) => {
  const dir = createPromptFixture(t, {});
  const invalid = validConfig.replace("prompt: Plan issue ${in.issueId}", 'prompt: "${file: prompts/missing.txt}"');

  assert.throws(() => parseServiceConfig(invalid, path.join(dir, "service.yml")), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /workflow\.issue-plan\.prompt: Included prompt file not found:/);
    assert.match(error.message, /prompts\/missing\.txt/);
    return true;
  });
});

test("parseServiceConfig rejects circular workflow prompt includes", (t) => {
  const dir = createPromptFixture(t, {
    "prompts/issue-plan.txt": "${file:partials/a.txt}",
    "prompts/partials/a.txt": "${file:b.txt}",
    "prompts/partials/b.txt": "${file:a.txt}"
  });
  const invalid = validConfig.replace("prompt: Plan issue ${in.issueId}", 'prompt: "${file: prompts/issue-plan.txt}"');

  assert.throws(() => parseServiceConfig(invalid, path.join(dir, "service.yml")), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /workflow\.issue-plan\.prompt: Prompt file include cycle detected:/);
    assert.match(error.message, /prompts\/partials\/a\.txt -> .*prompts\/partials\/b\.txt -> .*prompts\/partials\/a\.txt/);
    return true;
  });
});

test("parseServiceConfig rejects unknown workflow executor", () => {
  const invalid = validConfig.replace("use: claude", "use: unknown");
  assert.throws(() => parseServiceConfig(invalid, "/tmp/configs/test.yml"), {
    name: "ConfigError",
    message: /workflow\.issue-at\.use: Unknown executor 'unknown'\./
  });
});

test("parseServiceConfig accepts arbitrary non-empty trigger keys", () => {
  const parsed = parseServiceConfig(
    validConfig.replace("- issue:at", "- chat:command:triage"),
    "/tmp/configs/test.yml"
  );

  assert.deepEqual(parsed.workflow[1].on, ["chat:command:triage"]);
});

test("parseServiceConfig rejects duplicate keys from YAML parser", () => {
  const invalid = `${validConfig}\nserver:\n  host: 127.0.0.1\n  port: 3001`;
  assert.throws(() => parseServiceConfig(invalid, "/tmp/configs/test.yml"), {
    name: "ConfigError"
  });
});

test("parseServiceConfig requires a valid TCP port", () => {
  const invalid = validConfig.replace("port: 3000", "port: -1");

  assert.throws(() => parseServiceConfig(invalid, "/tmp/configs/test.yml"), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /server\.port: Expected an integer between 1 and 65535\./);
    return true;
  });
});

test("parseServiceConfig requires each workflow to declare at least one trigger", () => {
  const invalid = validConfig.replace(
    "    on:\n      - issue:at",
    "    on: []"
  );

  assert.throws(() => parseServiceConfig(invalid, "/tmp/configs/test.yml"), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /workflow\.issue-at\.on: Expected at least one trigger\./);
    return true;
  });
});

test("parseServiceConfig rejects empty trigger strings", () => {
  const invalid = validConfig.replace("- issue:at", "- ''");

  assert.throws(() => parseServiceConfig(invalid, "/tmp/configs/test.yml"), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /workflow\.issue-at\.on\[0\]: Expected a non-empty string\./);
    return true;
  });
});

test("parseServiceConfig requires positive executor timeouts", () => {
  const invalid = validConfig.replace("timeoutMs: 900000", "timeoutMs: 0");

  assert.throws(() => parseServiceConfig(invalid, "/tmp/configs/test.yml"), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /executors\.codex\.timeoutMs: Expected an integer greater than 0\./);
    return true;
  });
});

test("parseServiceConfig rejects invalid executor workspace values", () => {
  const invalid = validConfig.replace("    run: claude run ${prompt}", "    run: claude run ${prompt}\n    workspace: 123");

  assert.throws(() => parseServiceConfig(invalid, "/tmp/configs/test.yml"), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(
      error.message,
      /executors\.claude\.workspace: Expected a boolean or non-empty string\./
    );
    return true;
  });
});

test("parseServiceConfig rejects empty executor workspace mappings", () => {
  const invalid = validConfig.replace("    run: claude run ${prompt}", "    run: claude run ${prompt}\n    workspace: {}");

  assert.throws(() => parseServiceConfig(invalid, "/tmp/configs/test.yml"), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(
      error.message,
      /executors\.claude\.workspace: Expected a boolean, non-empty string, or mapping with at least one of 'baseDir' or 'key'\./
    );
    return true;
  });
});

test("parseServiceConfig rejects unsupported logging levels", () => {
  const invalid = `${validConfig}\nlogging:\n  level: verbose`;

  assert.throws(() => parseServiceConfig(invalid, "/tmp/configs/test.yml"), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /logging\.level: Expected one of: debug, info, warn, error\./);
    return true;
  });
});

function createPromptFixture(t: TestContext, files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "gao-config-prompts-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(dir, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, contents);
  }

  return dir;
}

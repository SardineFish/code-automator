import assert from "node:assert/strict";
import test from "node:test";

import { ConfigError } from "../../src/config/config-error.js";
import { parseServiceConfig } from "../../src/config/load-service-config.js";

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
    prompt: Plan issue \${in.subjectNumber} in \${in.repo}
  issue-at:
    on:
      - issue:comment
    use: claude
    prompt: Handle request \${in.content}
`;

test("parseServiceConfig returns ordered workflows and typed config", () => {
  const parsed = parseServiceConfig(validConfig, "/tmp/configs/test.yml");

  assert.equal(parsed.logging.level, "info");
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

test("parseServiceConfig rejects unknown workflow executor", () => {
  const invalid = validConfig.replace("use: claude", "use: unknown");
  assert.throws(() => parseServiceConfig(invalid, "/tmp/configs/test.yml"), {
    name: "ConfigError",
    message: /workflow\.issue-at\.use: Unknown executor 'unknown'\./
  });
});

test("parseServiceConfig accepts arbitrary non-empty trigger keys", () => {
  const parsed = parseServiceConfig(
    validConfig.replace("- issue:comment", "- chat:command:triage"),
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
    "    on:\n      - issue:comment",
    "    on: []"
  );

  assert.throws(() => parseServiceConfig(invalid, "/tmp/configs/test.yml"), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /workflow\.issue-at\.on: Expected at least one trigger\./);
    return true;
  });
});

test("parseServiceConfig rejects empty trigger strings", () => {
  const invalid = validConfig.replace("- issue:comment", "- ''");

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

test("parseServiceConfig rejects unsupported logging levels", () => {
  const invalid = `${validConfig}\nlogging:\n  level: verbose`;

  assert.throws(() => parseServiceConfig(invalid, "/tmp/configs/test.yml"), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /logging\.level: Expected one of: debug, info, warn, error\./);
    return true;
  });
});

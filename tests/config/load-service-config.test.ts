import assert from "node:assert/strict";
import test from "node:test";

import { ConfigError } from "../../src/config/config-error.js";
import { parseServiceConfig } from "../../src/config/load-service-config.js";

const validConfig = `
clientId: app-client-id
appId: 123456
botHandle: github-agent-orchestrator
server:
  host: 0.0.0.0
  port: 3000
  webhookPath: /webhooks/github
tracking:
  stateFile: state.json
  logFile: runs.jsonl
workspace:
  enabled: false
  baseDir: /tmp/gao
  cleanupAfterRun: false
whitelist:
  user:
    - octocat
  repo:
    - acme/demo
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

  assert.equal(parsed.clientId, "app-client-id");
  assert.equal(parsed.appId, 123456);
  assert.equal(parsed.tracking.stateFile, "/tmp/configs/state.json");
  assert.equal(parsed.tracking.logFile, "/tmp/configs/runs.jsonl");
  assert.equal(parsed.workflow[0].name, "issue-plan");
  assert.equal(parsed.workflow[1].name, "issue-at");
  assert.deepEqual(parsed.executors.codex.env, { FOO: "BAR" });
  assert.equal(parsed.executors.codex.timeoutMs, 900000);
});

test("parseServiceConfig rejects unknown workflow executor", () => {
  const invalid = validConfig.replace("use: claude", "use: unknown");
  assert.throws(() => parseServiceConfig(invalid, "/tmp/configs/test.yml"), {
    name: "ConfigError",
    message: /workflow\.issue-at\.use: Unknown executor 'unknown'\./
  });
});

test("parseServiceConfig rejects unsupported trigger keys", () => {
  const invalid = validConfig.replace("- issue:comment", "- issue:random");
  assert.throws(() => parseServiceConfig(invalid, "/tmp/configs/test.yml"), {
    name: "ConfigError",
    message: /workflow\.issue-at\.on\[0\]: Unsupported trigger 'issue:random'\./
  });
});

test("parseServiceConfig rejects duplicate keys from YAML parser", () => {
  const invalid = `${validConfig}\nclientId: duplicate`;
  assert.throws(() => parseServiceConfig(invalid, "/tmp/configs/test.yml"), {
    name: "ConfigError"
  });
});

test("parseServiceConfig requires webhook path to start with slash", () => {
  const invalid = validConfig.replace("webhookPath: /webhooks/github", "webhookPath: webhooks/github");

  assert.throws(() => parseServiceConfig(invalid, "/tmp/configs/test.yml"), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /server\.webhookPath: Expected a path starting with '\//);
    return true;
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

test("parseServiceConfig requires positive executor timeouts", () => {
  const invalid = validConfig.replace("timeoutMs: 900000", "timeoutMs: 0");

  assert.throws(() => parseServiceConfig(invalid, "/tmp/configs/test.yml"), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /executors\.codex\.timeoutMs: Expected an integer greater than 0\./);
    return true;
  });
});

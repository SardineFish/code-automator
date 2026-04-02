import type { ServiceConfig } from "../../src/types/config.js";

export function createServiceConfig(): ServiceConfig {
  return {
    clientId: "client-id",
    appId: 123456,
    botHandle: "github-agent-orchestrator",
    server: {
      host: "127.0.0.1",
      port: 3000,
      webhookPath: "/webhooks/github"
    },
    tracking: {
      stateFile: "/tmp/github-agent-orchestrator/state.json",
      logFile: "/tmp/github-agent-orchestrator/runs.jsonl"
    },
    workspace: {
      enabled: false,
      baseDir: "/tmp/github-agent-orchestrator",
      cleanupAfterRun: false
    },
    whitelist: {
      user: ["octocat", "reviewer"],
      repo: ["acme/demo"]
    },
    executors: {
      codex: {
        run: "codex exec ${prompt}",
        env: { EXECUTOR: "codex" },
        timeoutMs: 900000
      },
      claude: {
        run: "claude exec ${prompt}",
        env: { EXECUTOR: "claude" },
        timeoutMs: 900000
      }
    },
    workflow: [
      {
        name: "issue-plan",
        on: ["issue:open", "issue:command:plan"],
        use: "codex",
        prompt: "Plan subject ${in.subjectNumber} in ${in.repo}"
      },
      {
        name: "issue-implement",
        on: ["issue:command:approve", "issue:command:go", "issue:command:implement", "issue:command:code"],
        use: "claude",
        prompt: "Implement subject ${in.subjectNumber} in ${in.repo}"
      },
      {
        name: "issue-at",
        on: ["issue:comment"],
        use: "codex",
        prompt: "Handle ${in.content} on ${in.repo}"
      },
      {
        name: "pr-review",
        on: ["pr:comment", "pr:review"],
        use: "codex",
        prompt: "Review PR ${in.prNumber} in ${in.repo}: ${in.content}"
      }
    ]
  };
}

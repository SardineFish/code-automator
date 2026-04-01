import { type Document, isMap } from "yaml";

import type {
  ExecutorConfig,
  ServerConfig,
  ServiceConfig,
  WhitelistConfig,
  WorkflowDefinition,
  WorkspaceConfig
} from "../types/config.js";
import { isTriggerKey } from "../types/triggers.js";
import { ConfigError } from "./config-error.js";
import {
  expectMap,
  readBoolean,
  readInteger,
  readOptionalEnvMap,
  readRequiredNode,
  readString,
  readStringSequence
} from "./yaml-node-readers.js";

export function validateServiceConfigDocument(document: Document.Parsed): ServiceConfig {
  const root = expectMap(document.contents, "root");
  const clientId = readString(readRequiredNode(root, "clientId", "clientId"), "clientId");
  const appId = readInteger(readRequiredNode(root, "appId", "appId"), "appId");
  const botHandle = readString(readRequiredNode(root, "botHandle", "botHandle"), "botHandle");
  const server = readServerConfig(root);
  const workspace = readWorkspaceConfig(root);
  const whitelist = readWhitelistConfig(root);
  const executors = readExecutors(root);
  const workflow = readWorkflow(root, new Set(Object.keys(executors)));

  return { clientId, appId, botHandle, server, workspace, whitelist, executors, workflow };
}

function readServerConfig(root: ReturnType<typeof expectMap>): ServerConfig {
  const server = expectMap(readRequiredNode(root, "server", "server"), "server");
  const host = readString(readRequiredNode(server, "host", "server.host"), "server.host");
  const port = readInteger(readRequiredNode(server, "port", "server.port"), "server.port");
  const webhookPath = readString(
    readRequiredNode(server, "webhookPath", "server.webhookPath"),
    "server.webhookPath"
  );

  if (!webhookPath.startsWith("/")) {
    throw new ConfigError("server.webhookPath", "Expected a path starting with '/'.");
  }

  if (port < 1 || port > 65535) {
    throw new ConfigError("server.port", "Expected an integer between 1 and 65535.");
  }

  return { host, port, webhookPath };
}

function readWorkspaceConfig(root: ReturnType<typeof expectMap>): WorkspaceConfig {
  const workspace = expectMap(readRequiredNode(root, "workspace", "workspace"), "workspace");

  return {
    enabled: readBoolean(readRequiredNode(workspace, "enabled", "workspace.enabled"), "workspace.enabled"),
    baseDir: readString(readRequiredNode(workspace, "baseDir", "workspace.baseDir"), "workspace.baseDir"),
    cleanupAfterRun: readBoolean(
      readRequiredNode(workspace, "cleanupAfterRun", "workspace.cleanupAfterRun"),
      "workspace.cleanupAfterRun"
    )
  };
}

function readWhitelistConfig(root: ReturnType<typeof expectMap>): WhitelistConfig {
  const whitelist = expectMap(readRequiredNode(root, "whitelist", "whitelist"), "whitelist");

  return {
    user: readStringSequence(readRequiredNode(whitelist, "user", "whitelist.user"), "whitelist.user"),
    repo: readStringSequence(readRequiredNode(whitelist, "repo", "whitelist.repo"), "whitelist.repo")
  };
}

function readExecutors(root: ReturnType<typeof expectMap>): Record<string, ExecutorConfig> {
  const executors = expectMap(readRequiredNode(root, "executors", "executors"), "executors");
  const result: Record<string, ExecutorConfig> = {};

  for (const item of executors.items) {
    const name = readString(item.key, "executors.<key>");
    const executorPath = `executors.${name}`;
    const definition = expectMap(item.value, executorPath);
    const run = readString(readRequiredNode(definition, "run", `${executorPath}.run`), `${executorPath}.run`);
    const env = readOptionalEnvMap(definition.get("env", true), `${executorPath}.env`);
    result[name] = { run, env };
  }

  if (Object.keys(result).length === 0) {
    throw new ConfigError("executors", "Expected at least one executor.");
  }

  return result;
}

function readWorkflow(
  root: ReturnType<typeof expectMap>,
  executorNames: Set<string>
): WorkflowDefinition[] {
  const workflowMap = readRequiredNode(root, "workflow", "workflow");

  if (!isMap(workflowMap)) {
    throw new ConfigError("workflow", "Expected a mapping.");
  }

  const workflows: WorkflowDefinition[] = [];

  for (const item of workflowMap.items) {
    const name = readString(item.key, "workflow.<key>");
    const path = `workflow.${name}`;
    const entry = expectMap(item.value, path);
    const onValues = readStringSequence(readRequiredNode(entry, "on", `${path}.on`), `${path}.on`);
    const use = readString(readRequiredNode(entry, "use", `${path}.use`), `${path}.use`);
    const prompt = readString(readRequiredNode(entry, "prompt", `${path}.prompt`), `${path}.prompt`);

    if (onValues.length === 0) {
      throw new ConfigError(`${path}.on`, "Expected at least one trigger.");
    }

    if (!executorNames.has(use)) {
      throw new ConfigError(`${path}.use`, `Unknown executor '${use}'.`);
    }

    const on = onValues.map((value, index) => {
      if (!isTriggerKey(value)) {
        throw new ConfigError(`${path}.on[${index}]`, `Unsupported trigger '${value}'.`);
      }

      return value;
    });

    workflows.push({ name, on, use, prompt });
  }

  if (workflows.length === 0) {
    throw new ConfigError("workflow", "Expected at least one workflow.");
  }

  return workflows;
}

import path from "node:path";
import { type Document, isMap } from "yaml";

import type {
  AppConfig,
  ExecutorConfig,
  ServerConfig,
  TrackingConfig,
  WorkflowDefinition,
  WorkspaceConfig
} from "../types/config.js";
import { isTriggerKey } from "../types/triggers.js";
import { ConfigError } from "./config-error.js";
import {
  expectMap,
  readBoolean,
  readInteger,
  readOptionalInteger,
  readOptionalEnvMap,
  readRequiredNode,
  readString,
  readStringSequence
} from "./yaml-node-readers.js";

export function validateServiceConfigDocument(
  document: Document.Parsed,
  baseDir: string
): AppConfig {
  const root = expectMap(document.contents, "root");
  const server = readServerConfig(root);
  const workspace = readWorkspaceConfig(root);
  const tracking = readTrackingConfig(root, baseDir);
  const executors = readExecutors(root);
  const workflow = readWorkflow(root, new Set(Object.keys(executors)));
  const providerSections = readProviderSections(document);

  return {
    ...providerSections,
    server,
    workspace,
    tracking,
    executors,
    workflow
  };
}

function readServerConfig(root: ReturnType<typeof expectMap>): ServerConfig {
  const server = expectMap(readRequiredNode(root, "server", "server"), "server");
  const host = readString(readRequiredNode(server, "host", "server.host"), "server.host");
  const port = readInteger(readRequiredNode(server, "port", "server.port"), "server.port");
  if (port < 1 || port > 65535) {
    throw new ConfigError("server.port", "Expected an integer between 1 and 65535.");
  }
  return { host, port };
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

function readTrackingConfig(root: ReturnType<typeof expectMap>, baseDir: string): TrackingConfig {
  const tracking = expectMap(readRequiredNode(root, "tracking", "tracking"), "tracking");

  return {
    stateFile: resolveTrackingPath(
      readString(readRequiredNode(tracking, "stateFile", "tracking.stateFile"), "tracking.stateFile"),
      baseDir
    ),
    logFile: resolveTrackingPath(
      readString(readRequiredNode(tracking, "logFile", "tracking.logFile"), "tracking.logFile"),
      baseDir
    )
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
    const timeoutMs = readOptionalInteger(
      definition.get("timeoutMs", true),
      `${executorPath}.timeoutMs`
    );

    if (timeoutMs !== undefined && timeoutMs < 1) {
      throw new ConfigError(`${executorPath}.timeoutMs`, "Expected an integer greater than 0.");
    }
    result[name] = { run, env, timeoutMs };
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

function resolveTrackingPath(filePath: string, baseDir: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
}

function readProviderSections(document: Document.Parsed): Record<string, unknown> {
  const rawConfig = document.toJS() as Record<string, unknown>;
  const providerSections: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(rawConfig)) {
    if (!CORE_TOP_LEVEL_KEYS.has(key)) {
      providerSections[key] = value;
    }
  }

  return providerSections;
}

const CORE_TOP_LEVEL_KEYS = new Set([
  "server",
  "tracking",
  "workspace",
  "executors",
  "workflow"
]);

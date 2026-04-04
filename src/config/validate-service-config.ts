import path from "node:path";
import { type Document, isMap } from "yaml";

import type {
  ExecutorConfig,
  ExecutorWorkspaceOptions,
  LoggingConfig,
  ServerConfig,
  ServiceConfig,
  TrackingConfig,
  WorkflowDefinition,
  WorkspaceConfig
} from "../types/config.js";
import { runtimeLogLevels } from "../types/logging.js";
import { isTriggerKey } from "../types/triggers.js";
import { ConfigError } from "./config-error.js";
import { expandWorkflowPromptFileIncludes } from "./expand-workflow-prompt-file-includes.js";
import {
  expectMap,
  readBoolean,
  readInteger,
  readOptionalBooleanOrString,
  readOptionalInteger,
  readOptionalEnvMap,
  readRequiredNode,
  readString,
  readStringSequence
} from "./yaml-node-readers.js";

export function validateServiceConfigDocument(
  document: Document.Parsed,
  baseDir: string
): ServiceConfig {
  const root = expectMap(document.contents, "root");
  const server = readServerConfig(root);
  const logging = readLoggingConfig(root);
  const workspace = readWorkspaceConfig(root, baseDir);
  const tracking = readTrackingConfig(root, baseDir);
  const executors = readExecutors(root, baseDir);
  const workflow = readWorkflow(root, new Set(Object.keys(executors)), baseDir);
  const providerSections = readProviderSections(document);

  return {
    ...providerSections,
    configDir: baseDir,
    server,
    logging,
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

function readLoggingConfig(root: ReturnType<typeof expectMap>): LoggingConfig {
  const loggingNode = root.get("logging", true);

  if (!loggingNode) {
    return { level: "info" };
  }

  const logging = expectMap(loggingNode, "logging");
  const levelNode = logging.get("level", true);

  if (!levelNode) {
    return { level: "info" };
  }

  const level = readString(levelNode, "logging.level");

  if (!isRuntimeLogLevel(level)) {
    throw new ConfigError(
      "logging.level",
      `Expected one of: ${runtimeLogLevels.join(", ")}.`
    );
  }

  return { level };
}

function isRuntimeLogLevel(value: string): value is LoggingConfig["level"] {
  return runtimeLogLevels.includes(value as LoggingConfig["level"]);
}

function readWorkspaceConfig(root: ReturnType<typeof expectMap>, baseDir: string): WorkspaceConfig {
  const workspace = expectMap(readRequiredNode(root, "workspace", "workspace"), "workspace");

  return {
    enabled: readBoolean(readRequiredNode(workspace, "enabled", "workspace.enabled"), "workspace.enabled"),
    baseDir: resolveConfigPath(
      readString(readRequiredNode(workspace, "baseDir", "workspace.baseDir"), "workspace.baseDir"),
      baseDir
    ),
    cleanupAfterRun: readBoolean(
      readRequiredNode(workspace, "cleanupAfterRun", "workspace.cleanupAfterRun"),
      "workspace.cleanupAfterRun"
    )
  };
}

function readTrackingConfig(root: ReturnType<typeof expectMap>, baseDir: string): TrackingConfig {
  const tracking = expectMap(readRequiredNode(root, "tracking", "tracking"), "tracking");

  return {
    stateFile: resolveConfigPath(
      readString(readRequiredNode(tracking, "stateFile", "tracking.stateFile"), "tracking.stateFile"),
      baseDir
    ),
    logFile: resolveConfigPath(
      readString(readRequiredNode(tracking, "logFile", "tracking.logFile"), "tracking.logFile"),
      baseDir
    )
  };
}

function readExecutors(root: ReturnType<typeof expectMap>, baseDir: string): Record<string, ExecutorConfig> {
  const executors = expectMap(readRequiredNode(root, "executors", "executors"), "executors");
  const result: Record<string, ExecutorConfig> = {};

  for (const item of executors.items) {
    const name = readString(item.key, "executors.<key>");
    const executorPath = `executors.${name}`;
    const definition = expectMap(item.value, executorPath);
    const run = readString(readRequiredNode(definition, "run", `${executorPath}.run`), `${executorPath}.run`);
    const env = readOptionalEnvMap(definition.get("env", true), `${executorPath}.env`);
    const workspace = readOptionalExecutorWorkspace(
      definition.get("workspace", true),
      `${executorPath}.workspace`,
      baseDir
    );
    const timeoutMs = readOptionalInteger(
      definition.get("timeoutMs", true),
      `${executorPath}.timeoutMs`
    );

    if (timeoutMs !== undefined && timeoutMs < 1) {
      throw new ConfigError(`${executorPath}.timeoutMs`, "Expected an integer greater than 0.");
    }
    result[name] = { run, env, timeoutMs, workspace };
  }
  if (Object.keys(result).length === 0) {
    throw new ConfigError("executors", "Expected at least one executor.");
  }
  return result;
}

function readWorkflow(
  root: ReturnType<typeof expectMap>,
  executorNames: Set<string>,
  baseDir: string
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
    const prompt = expandWorkflowPromptFileIncludes(
      readString(readRequiredNode(entry, "prompt", `${path}.prompt`), `${path}.prompt`),
      `${path}.prompt`,
      baseDir
    );

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

function resolveConfigPath(filePath: string, baseDir: string): string {
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
  "logging",
  "tracking",
  "workspace",
  "executors",
  "workflow"
]);

function readOptionalExecutorWorkspace(
  node: unknown,
  path: string,
  baseDir: string
): ExecutorConfig["workspace"] | undefined {
  if (!node) {
    return undefined;
  }

  if (!isMap(node)) {
    const workspace = readOptionalBooleanOrString(node, path);
    return typeof workspace === "string" ? resolveConfigPath(workspace, baseDir) : workspace;
  }

  const workspace = expectMap(node, path);
  const baseDirNode = workspace.get("baseDir", true);
  const keyNode = workspace.get("key", true);
  const result: ExecutorWorkspaceOptions = {};

  if (baseDirNode) {
    result.baseDir = resolveConfigPath(readString(baseDirNode, `${path}.baseDir`), baseDir);
  }

  if (keyNode) {
    result.key = readString(keyNode, `${path}.key`);
  }

  if (result.baseDir === undefined && result.key === undefined) {
    throw new ConfigError(
      path,
      "Expected a boolean, non-empty string, or mapping with at least one of 'baseDir' or 'key'."
    );
  }

  return result;
}

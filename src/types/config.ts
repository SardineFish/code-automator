import type { TriggerKey } from "./triggers.js";

export interface ServerConfig {
  host: string;
  port: number;
  webhookPath: string;
}

export interface WorkspaceConfig {
  enabled: boolean;
  baseDir: string;
  cleanupAfterRun: boolean;
}

export interface WhitelistConfig {
  user: string[];
  repo: string[];
}

export interface ExecutorConfig {
  run: string;
  env: Record<string, string>;
}

export interface WorkflowConfigEntry {
  on: TriggerKey[];
  use: string;
  prompt: string;
}

export interface WorkflowDefinition extends WorkflowConfigEntry {
  name: string;
}

export interface RawServiceConfig {
  clientId: string;
  appId: number;
  botHandle: string;
  server: ServerConfig;
  workspace: WorkspaceConfig;
  whitelist: WhitelistConfig;
  executors: Record<string, ExecutorConfig>;
  workflow: Record<string, WorkflowConfigEntry>;
}

export interface ServiceConfig {
  clientId: string;
  appId: number;
  botHandle: string;
  server: ServerConfig;
  workspace: WorkspaceConfig;
  whitelist: WhitelistConfig;
  executors: Record<string, ExecutorConfig>;
  workflow: WorkflowDefinition[];
}

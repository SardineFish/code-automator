import type { TriggerKey } from "./triggers.js";

export interface ServerConfig {
  host: string;
  port: number;
}

export interface WorkspaceConfig {
  enabled: boolean;
  baseDir: string;
  cleanupAfterRun: boolean;
}

export interface TrackingConfig {
  stateFile: string;
  logFile: string;
}

export interface WhitelistConfig {
  user: string[];
  repo: string[];
}

export interface ExecutorConfig {
  run: string;
  env: Record<string, string>;
  timeoutMs?: number;
}

export interface WorkflowConfigEntry {
  on: TriggerKey[];
  use: string;
  prompt: string;
}

export interface WorkflowDefinition extends WorkflowConfigEntry {
  name: string;
}

export interface AppConfig {
  [key: string]: unknown;
  server: ServerConfig;
  workspace: WorkspaceConfig;
  tracking: TrackingConfig;
  executors: Record<string, ExecutorConfig>;
  workflow: WorkflowDefinition[];
}

export type RawServiceConfig = AppConfig;
export type ServiceConfig = AppConfig;

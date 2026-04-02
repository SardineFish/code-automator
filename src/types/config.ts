import type { TriggerKey } from "./triggers.js";
import type { RuntimeLogLevel } from "./logging.js";

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

export interface LoggingConfig {
  level: RuntimeLogLevel;
}

export interface WhitelistConfig {
  user: string[];
  repo: string[];
}

export interface GitHubProviderConfig {
  url: string;
  clientId: string;
  appId: number;
  botHandle: string;
  whitelist: WhitelistConfig;
  redelivery?: false | GitHubRedeliveryConfig;
}

export interface GitHubRedeliveryConfig {
  intervalSeconds: number;
  maxPerRun: number;
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
  logging: LoggingConfig;
  workspace: WorkspaceConfig;
  tracking: TrackingConfig;
  gh?: GitHubProviderConfig;
  executors: Record<string, ExecutorConfig>;
  workflow: WorkflowDefinition[];
}

export type RawServiceConfig = AppConfig;
export type ServiceConfig = AppConfig;

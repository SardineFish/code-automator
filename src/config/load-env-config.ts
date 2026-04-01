import { config as loadDotenv, type DotenvConfigOptions } from "dotenv";

import { ConfigError } from "./config-error.js";

export interface EnvironmentConfig {
  webhookSecret: string;
}

export function loadEnvironmentConfig(env: NodeJS.ProcessEnv = process.env): EnvironmentConfig {
  const webhookSecret = env.GITHUB_WEBHOOK_SECRET;

  if (!webhookSecret || webhookSecret.trim() === "") {
    throw new ConfigError("env.GITHUB_WEBHOOK_SECRET", "Missing required webhook secret.");
  }

  return { webhookSecret };
}

export function loadEnvironmentFromDotenv(
  options?: DotenvConfigOptions,
  env: NodeJS.ProcessEnv = process.env
): EnvironmentConfig {
  const result = loadDotenv(options);

  if (result.error && options?.path) {
    throw result.error;
  }

  return loadEnvironmentConfig(env);
}

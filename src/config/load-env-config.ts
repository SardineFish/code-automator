import { config as loadDotenv, type DotenvConfigOptions } from "dotenv";

import { ConfigError } from "./config-error.js";

export interface EnvironmentConfig {
  webhookSecret: string;
  appPrivateKeyPath: string;
}

export function loadEnvironmentConfig(env: NodeJS.ProcessEnv = process.env): EnvironmentConfig {
  const webhookSecret = env.GITHUB_WEBHOOK_SECRET;
  const appPrivateKeyPath = env.GITHUB_APP_PRIVATE_KEY_PATH;

  if (!webhookSecret || webhookSecret.trim() === "") {
    throw new ConfigError("env.GITHUB_WEBHOOK_SECRET", "Missing required webhook secret.");
  }

  if (!appPrivateKeyPath || appPrivateKeyPath.trim() === "") {
    throw new ConfigError(
      "env.GITHUB_APP_PRIVATE_KEY_PATH",
      "Missing required GitHub App private key path."
    );
  }

  return { webhookSecret, appPrivateKeyPath };
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

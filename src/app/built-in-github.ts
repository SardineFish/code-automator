import type { ServiceConfig } from "../types/config.js";
import { resolveGitHubProviderConfig, type ResolvedGitHubProviderConfig } from "./providers/github-config.js";
import { requireEnv } from "./providers/github-utils.js";

export interface BuiltInGitHubRuntimeConfig {
  runtimeConfig: ServiceConfig;
  github?: ResolvedGitHubProviderConfig;
}

export function resolveBuiltInGitHubRuntimeConfig(config: ServiceConfig): BuiltInGitHubRuntimeConfig {
  if (!config.gh) {
    return { runtimeConfig: config };
  }

  const github = resolveGitHubProviderConfig(config.gh);

  return {
    runtimeConfig: { ...config, gh: github },
    github
  };
}

export function requireBuiltInGitHubEnv(
  github: ResolvedGitHubProviderConfig | undefined,
  env: NodeJS.ProcessEnv
): void {
  if (!github) {
    return;
  }

  requireEnv(env, "GITHUB_WEBHOOK_SECRET");
  requireEnv(env, "GITHUB_APP_PRIVATE_KEY_PATH");
}

import { ConfigError } from "../../config/config-error.js";
import type { GitHubProviderConfig, GitHubRedeliveryConfig, WhitelistConfig } from "../../types/config.js";

export interface ResolvedGitHubProviderConfig extends Omit<GitHubProviderConfig, "redelivery" | "requireMention"> {
  requireMention: boolean;
  redelivery: false | GitHubRedeliveryConfig;
}

export function resolveGitHubProviderConfig(value: unknown): ResolvedGitHubProviderConfig {
  const github = expectObject(value, "gh");

  return {
    url: readRoutePath(github.url, "gh.url"),
    clientId: readNonEmptyString(github.clientId, "gh.clientId"),
    appId: readPositiveInteger(github.appId, "gh.appId"),
    botHandle: readNonEmptyString(github.botHandle, "gh.botHandle"),
    requireMention: readBoolean(github.requireMention, "gh.requireMention", true),
    whitelist: readWhitelist(github.whitelist),
    redelivery: readRedelivery(github.redelivery)
  };
}

function readWhitelist(value: unknown): WhitelistConfig {
  const whitelist = expectObject(value, "gh.whitelist");

  return {
    user: readStringArray(whitelist.user, "gh.whitelist.user"),
    repo: readStringArray(whitelist.repo, "gh.whitelist.repo")
  };
}

function readRedelivery(value: unknown): false | GitHubRedeliveryConfig {
  if (value === undefined || value === false) {
    return false;
  }

  const redelivery = expectObject(value, "gh.redelivery");

  return {
    intervalSeconds: readPositiveInteger(redelivery.intervalSeconds, "gh.redelivery.intervalSeconds"),
    maxPerRun: readPositiveInteger(redelivery.maxPerRun, "gh.redelivery.maxPerRun")
  };
}

function readRoutePath(value: unknown, path: string): string {
  const routePath = readNonEmptyString(value, path);

  if (!routePath.startsWith("/")) {
    throw new ConfigError(path, "Expected a path that starts with '/'.");
  }

  return routePath;
}

function readStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new ConfigError(path, "Expected a sequence.");
  }

  return value.map((entry, index) => readNonEmptyString(entry, `${path}[${index}]`));
}

function readPositiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ConfigError(path, "Expected an integer greater than 0.");
  }

  return value;
}

function readBoolean(value: unknown, path: string, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "boolean") {
    throw new ConfigError(path, "Expected a boolean.");
  }

  return value;
}

function readNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(path, "Expected a non-empty string.");
  }

  return value;
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError(path, "Expected a mapping.");
  }

  return value as Record<string, unknown>;
}

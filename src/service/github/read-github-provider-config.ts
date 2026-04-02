import { ConfigError } from "../../config/config-error.js";
import type { AppConfig, WhitelistConfig } from "../../types/config.js";

export interface GitHubProviderConfig {
  url: string;
  clientId: string;
  appId: number;
  botHandle: string;
  whitelist: WhitelistConfig;
}

export function readGitHubProviderConfig(config: AppConfig): GitHubProviderConfig {
  const section = asRecord(config.gh, "gh");
  const whitelist = asRecord(section.whitelist, "gh.whitelist");

  return {
    url: readPath(section.url, "gh.url"),
    clientId: readString(section.clientId, "gh.clientId"),
    appId: readInteger(section.appId, "gh.appId"),
    botHandle: readString(section.botHandle, "gh.botHandle"),
    whitelist: {
      user: readStringArray(whitelist.user, "gh.whitelist.user"),
      repo: readStringArray(whitelist.repo, "gh.whitelist.repo")
    }
  };
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError(path, "Expected a mapping.");
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(path, "Expected a non-empty string.");
  }

  return value;
}

function readPath(value: unknown, path: string): string {
  const parsed = readString(value, path);

  if (!parsed.startsWith("/")) {
    throw new ConfigError(path, "Expected a path starting with '/'.");
  }

  return parsed;
}

function readInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ConfigError(path, "Expected an integer.");
  }

  return value;
}

function readStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigError(path, "Expected a non-empty sequence.");
  }

  return value.map((item, index) => readString(item, `${path}[${index}]`));
}

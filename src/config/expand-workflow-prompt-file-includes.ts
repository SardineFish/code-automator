import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { ConfigError } from "./config-error.js";

const FILE_INCLUDE_PATTERN = /\$\{file:([^}]+)\}/g;

interface IncludeContext {
  configPath: string;
  baseDir: string;
  includeChain: string[];
}

export function expandWorkflowPromptFileIncludes(
  template: string,
  configPath: string,
  configBaseDir: string
): string {
  return expandPromptTemplate(template, {
    configPath,
    baseDir: configBaseDir,
    includeChain: []
  });
}

function expandPromptTemplate(template: string, context: IncludeContext): string {
  return template.replaceAll(FILE_INCLUDE_PATTERN, (_, includePathRaw: string) => {
    const includePath = includePathRaw.trim();

    if (includePath.length === 0) {
      throw new ConfigError(context.configPath, "Prompt file include path is empty.");
    }

    const absolutePath = path.isAbsolute(includePath)
      ? path.normalize(includePath)
      : path.resolve(context.baseDir, includePath);
    const nextChain = [...context.includeChain, absolutePath];

    if (context.includeChain.includes(absolutePath)) {
      throw new ConfigError(
        context.configPath,
        `Prompt file include cycle detected: ${nextChain.join(" -> ")}.`
      );
    }

    return expandPromptTemplate(readPromptFile(absolutePath, context.configPath, nextChain), {
      configPath: context.configPath,
      baseDir: path.dirname(absolutePath),
      includeChain: nextChain
    });
  });
}

function readPromptFile(absolutePath: string, configPath: string, includeChain: string[]): string {
  let stats;

  try {
    stats = statSync(absolutePath);
  } catch {
    throw new ConfigError(
      configPath,
      `Included prompt file not found: '${absolutePath}' (include chain: ${includeChain.join(" -> ")}).`
    );
  }

  if (!stats.isFile()) {
    throw new ConfigError(
      configPath,
      `Included prompt path is not a file: '${absolutePath}' (include chain: ${includeChain.join(" -> ")}).`
    );
  }

  try {
    return readFileSync(absolutePath, "utf8");
  } catch (error) {
    throw new ConfigError(
      configPath,
      `Failed to read included prompt file '${absolutePath}' (include chain: ${includeChain.join(" -> ")}): ${formatErrorMessage(error)}`
    );
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown file read error.";
}

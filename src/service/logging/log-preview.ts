import { readFile } from "node:fs/promises";

import type { ProcessRunResult } from "../../types/execution.js";

export const LOG_PREVIEW_LIMIT = 256;
const CLIPPED_SUFFIX = "... [clipped]";

export function clipLogPreview(value: string, maxLength = LOG_PREVIEW_LIMIT): string {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\n+$/g, "");

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - CLIPPED_SUFFIX.length))}${CLIPPED_SUFFIX}`;
}

export async function readProcessOutputPreview(
  result: ProcessRunResult | undefined,
  stream: "stdout" | "stderr",
  maxLength = LOG_PREVIEW_LIMIT
): Promise<string | null> {
  const inlineOutput = result?.[stream];

  if (typeof inlineOutput === "string" && inlineOutput !== "") {
    return clipLogPreview(inlineOutput, maxLength);
  }

  const outputPath = stream === "stdout" ? result?.stdoutPath : result?.stderrPath;

  if (!outputPath) {
    return null;
  }

  try {
    return clipLogPreview(await readFile(outputPath, "utf8"), maxLength);
  } catch {
    return null;
  }
}

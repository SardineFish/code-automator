import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ServiceConfig } from "../types/config.js";
import { parseYamlDocument } from "./read-yaml-config.js";
import { validateServiceConfigDocument } from "./validate-service-config.js";

export async function loadServiceConfig(filePath: string): Promise<ServiceConfig> {
  const source = await readFile(filePath, "utf8");
  return parseServiceConfig(source, filePath, path.dirname(path.resolve(filePath)));
}

export function parseServiceConfig(
  source: string,
  sourceLabel = "config.yml",
  baseDir = path.dirname(path.resolve(sourceLabel))
): ServiceConfig {
  const document = parseYamlDocument(source, sourceLabel);
  return validateServiceConfigDocument(document, baseDir);
}

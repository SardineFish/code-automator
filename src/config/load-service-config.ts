import { readFile } from "node:fs/promises";

import type { ServiceConfig } from "../types/config.js";
import { parseYamlDocument } from "./read-yaml-config.js";
import { validateServiceConfigDocument } from "./validate-service-config.js";

export async function loadServiceConfig(filePath: string): Promise<ServiceConfig> {
  const source = await readFile(filePath, "utf8");
  return parseServiceConfig(source, filePath);
}

export function parseServiceConfig(source: string, sourceLabel = "config.yml"): ServiceConfig {
  const document = parseYamlDocument(source, sourceLabel);
  return validateServiceConfigDocument(document);
}

import { parseDocument } from "yaml";

import { ConfigError } from "./config-error.js";

export function parseYamlDocument(source: string, sourceLabel: string) {
  const document = parseDocument(source, { uniqueKeys: true, prettyErrors: false });

  if (document.errors.length > 0) {
    throw new ConfigError(sourceLabel, document.errors[0].message.trim());
  }

  return document;
}

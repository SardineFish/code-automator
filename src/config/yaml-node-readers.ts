import { isMap, isScalar, isSeq, type YAMLMap } from "yaml";

import { ConfigError } from "./config-error.js";

export function expectMap(node: unknown, path: string): YAMLMap {
  if (!isMap(node)) {
    throw new ConfigError(path, "Expected a mapping.");
  }

  return node;
}

export function readRequiredNode(map: YAMLMap, key: string, path: string): unknown {
  const node = map.get(key, true);

  if (!node) {
    throw new ConfigError(path, "Missing required field.");
  }

  return node;
}

export function readString(node: unknown, path: string): string {
  if (!isScalar(node) || typeof node.value !== "string" || node.value.trim() === "") {
    throw new ConfigError(path, "Expected a non-empty string.");
  }

  return node.value;
}

export function readBoolean(node: unknown, path: string): boolean {
  if (!isScalar(node) || typeof node.value !== "boolean") {
    throw new ConfigError(path, "Expected a boolean.");
  }

  return node.value;
}

export function readInteger(node: unknown, path: string): number {
  if (!isScalar(node) || typeof node.value !== "number" || !Number.isInteger(node.value)) {
    throw new ConfigError(path, "Expected an integer.");
  }

  return node.value;
}

export function readOptionalInteger(node: unknown, path: string): number | undefined {
  if (!node) {
    return undefined;
  }

  return readInteger(node, path);
}

export function readStringSequence(node: unknown, path: string): string[] {
  if (!isSeq(node)) {
    throw new ConfigError(path, "Expected a sequence.");
  }

  return node.items.map((item, index) => readString(item, `${path}[${index}]`));
}

export function readOptionalEnvMap(node: unknown, path: string): Record<string, string> {
  if (!node) {
    return {};
  }

  const envMap = expectMap(node, path);
  const result: Record<string, string> = {};

  for (const item of envMap.items) {
    const key = readString(item.key, `${path}.<key>`);
    result[key] = readString(item.value, `${path}.${key}`);
  }

  return result;
}

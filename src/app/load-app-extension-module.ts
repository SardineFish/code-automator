import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  APP_EXTENSION_API_VERSION,
  type AppExtensionDefinition,
  type AppExtensionModule
} from "../types/extensions.js";

const require = createRequire(import.meta.url);
const SUPPORTED_EXTENSION_FILE_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

export async function loadAppExtensionModule(
  definition: AppExtensionDefinition
): Promise<AppExtensionModule> {
  const entryPath = await resolveExtensionEntrypoint(definition);

  let importedModule: unknown;

  try {
    importedModule = await import(pathToFileURL(entryPath).href);
  } catch (error) {
    throw new Error(
      `Failed to import extension '${definition.id}' from '${entryPath}': ${formatErrorMessage(error)}`
    );
  }

  const candidate = (importedModule as { default?: unknown }).default ?? importedModule;

  return validateAppExtensionModule(candidate, definition, entryPath);
}

async function resolveExtensionEntrypoint(definition: AppExtensionDefinition): Promise<string> {
  let targetStat: Awaited<ReturnType<typeof stat>>;

  try {
    targetStat = await stat(definition.use);
  } catch (error) {
    throw new Error(
      `Extension '${definition.id}' path '${definition.use}' was not found: ${formatErrorMessage(error)}`
    );
  }

  if (targetStat.isDirectory()) {
    try {
      return require.resolve(definition.use);
    } catch (error) {
      throw new Error(
        `Extension '${definition.id}' directory '${definition.use}' does not expose a resolvable package entrypoint: ${formatErrorMessage(error)}`
      );
    }
  }

  if (!targetStat.isFile()) {
    throw new Error(
      `Extension '${definition.id}' target '${definition.use}' must be a JavaScript file or package directory.`
    );
  }

  const extensionName = path.extname(definition.use);

  if (!SUPPORTED_EXTENSION_FILE_EXTENSIONS.has(extensionName)) {
    throw new Error(
      `Extension '${definition.id}' file '${definition.use}' must end in .js, .mjs, or .cjs.`
    );
  }

  return definition.use;
}

function validateAppExtensionModule(
  candidate: unknown,
  definition: AppExtensionDefinition,
  entryPath: string
): AppExtensionModule {
  if (!isObject(candidate)) {
    throw new Error(
      `Extension '${definition.id}' from '${entryPath}' must export an object with API_VERSION and init().`
    );
  }

  if (candidate.API_VERSION !== APP_EXTENSION_API_VERSION) {
    throw new Error(
      `Extension '${definition.id}' from '${entryPath}' declares API_VERSION ${formatValue(candidate.API_VERSION)} but the runtime requires ${APP_EXTENSION_API_VERSION}.`
    );
  }

  if (typeof candidate.init !== "function") {
    throw new Error(
      `Extension '${definition.id}' from '${entryPath}' must export an init(builder, context) function.`
    );
  }

  return candidate as unknown as AppExtensionModule;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown extension load error.";
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return `'${value}'`;
  }

  const serialized = JSON.stringify(value);
  return serialized ?? String(value);
}

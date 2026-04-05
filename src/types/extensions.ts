import type { LogSink } from "./logging.js";
import type { AppServiceHandler, ProviderHandler } from "./runtime.js";

export const APP_EXTENSION_API_VERSION = 1 as const;

export interface AppExtensionDefinition {
  id: string;
  use: string;
  config?: unknown;
}

export interface AppExtensionContext<TConfig = unknown> {
  id: string;
  config: TConfig;
  configDir: string;
  env: NodeJS.ProcessEnv;
  log: LogSink;
}

export interface AppExtensionBuilder<TConfig = unknown> {
  provider<TArgs extends unknown[] = unknown[], TResult = unknown>(
    key: string,
    handler: ProviderHandler<TArgs, TResult, TConfig>
  ): AppExtensionBuilder<TConfig>;
  service(handler: AppServiceHandler<TConfig>): AppExtensionBuilder<TConfig>;
}

export interface AppExtensionModule<TConfig = unknown> {
  API_VERSION: typeof APP_EXTENSION_API_VERSION;
  init(builder: AppExtensionBuilder<TConfig>, context: AppExtensionContext<TConfig>): void | Promise<void>;
}

import type { ServiceConfig } from "../types/config.js";
import type { AnyProvider, AppContext } from "../types/runtime.js";
import type { AppRuntimeOptions } from "./default-app-runtime.js";
import { createWorkflowContext } from "./create-workflow-context.js";

export class UnknownProviderError extends Error {
  constructor(key: string) {
    super(`Unknown provider key '${key}'.`);
  }
}

export interface ManagedAppContext {
  appContext: AppContext;
  shutdown(): Promise<void>;
}

export interface CreateAppContextOptions {
  config: ServiceConfig;
  runtime: AppRuntimeOptions;
  providers: ReadonlyMap<string, AnyProvider>;
}

export function createAppContext(options: CreateAppContextOptions): ManagedAppContext {
  const shutdownHandlers: Array<() => Promise<void>> = [];
  const appLog = options.runtime.logSink.child({ source: "app" });
  let shutdownPromise: Promise<void> | undefined;

  return {
    appContext: {
      config: options.config,
      env: options.runtime.baseEnv,
      log: appLog,
      createWorkflow(source) {
        return createWorkflowContext(source, options.config, options.runtime);
      },
      getProvider<T extends AnyProvider>(key: string): T {
        const provider = options.providers.get(key);

        if (!provider) {
          throw new UnknownProviderError(key);
        }

        return provider as T;
      },
      on(eventName, handler) {
        if (eventName !== "shutdown") {
          throw new Error(`Unsupported app event '${eventName}'.`);
        }

        shutdownHandlers.push(handler);

        return () => {
          const index = shutdownHandlers.indexOf(handler);
          if (index !== -1) {
            shutdownHandlers.splice(index, 1);
          }
        };
      }
    },
    shutdown() {
      if (shutdownPromise) {
        return shutdownPromise;
      }

      shutdownPromise = runShutdownHandlers(shutdownHandlers, appLog);
      return shutdownPromise;
    }
  };
}

async function runShutdownHandlers(
  handlers: Array<() => Promise<void>>,
  appLog: { warn(entry: Record<string, unknown>): void }
): Promise<void> {
  for (const handler of [...handlers]) {
    try {
      await handler();
    } catch (error) {
      appLog.warn({
        message: "app shutdown handler failed",
        errorMessage: error instanceof Error ? error.message : "Unknown shutdown handler error."
      });
    }
  }
}

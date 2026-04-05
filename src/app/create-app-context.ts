import type { ServiceConfig } from "../types/config.js";
import type { LogSink } from "../types/logging.js";
import type { HttpProviderKey, NonHttpProviderKey } from "../types/provider-keys.js";
import type { AnyProvider, AppContext, HttpRequestProvider } from "../types/runtime.js";
import { createAppManagedJobs, type AppManagedJobs } from "./app-managed-jobs.js";
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
  const managedJobs = createAppManagedJobs(appLog);
  let shutdownPromise: Promise<void> | undefined;

  function getProvider(key: HttpProviderKey): HttpRequestProvider;
  function getProvider<T extends AnyProvider, TKey extends string = string>(
    key: NonHttpProviderKey<TKey>
  ): T;
  function getProvider<T extends AnyProvider>(key: string): T {
    const provider = options.providers.get(key);

    if (!provider) {
      throw new UnknownProviderError(key);
    }

    return provider as T;
  }

  return {
    appContext: {
      config: options.config,
      env: options.runtime.baseEnv,
      log: appLog,
      createWorkflow(source) {
        return createWorkflowContext(source, options.config, options.runtime);
      },
      getProvider,
      trackJob: managedJobs.trackJob,
      scheduleInterval: managedJobs.scheduleInterval,
      scheduleDelay: managedJobs.scheduleDelay,
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

      shutdownPromise = runShutdownHandlers(shutdownHandlers, managedJobs, appLog);
      return shutdownPromise;
    }
  };
}

async function runShutdownHandlers(
  handlers: Array<() => Promise<void>>,
  managedJobs: AppManagedJobs,
  appLog: Pick<LogSink, "warn">
): Promise<void> {
  managedJobs.stopSchedulers();
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
  await managedJobs.waitForTrackedJobsDuringShutdown();
}

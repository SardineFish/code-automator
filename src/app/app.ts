import { initFetchHelper } from "../providers/http/fetch-helper.js";
import type { ServiceConfig } from "../types/config.js";
import type { AnyProvider, AppServiceHandler, ProviderHandler } from "../types/runtime.js";
import {
  createAppRuntimeOptions,
  type AppRuntimeOptions,
  type AppRuntimeOverrides,
  initializeWorkflowTracking,
  type WorkflowTrackingCleanup
} from "./default-app-runtime.js";
import { createAppContext } from "./create-app-context.js";
import { createHttpAppService } from "./http-app-service.js";

export type AppOptions = AppRuntimeOverrides;
export type { ProviderHandler } from "../types/runtime.js";

export interface AppLifecycle {
  server: import("node:http").Server;
  shutdown(): Promise<void>;
}

export function App(config: ServiceConfig, options: AppOptions = {}): AppBuilder {
  initFetchHelper(config.proxy);
  return new AppBuilder(config, createAppRuntimeOptions(config, options));
}

class AppBuilder {
  readonly #httpService;
  readonly #providers = new Map<string, AnyProvider>();
  readonly #services: AppServiceHandler[] = [];
  #initializePromise?: Promise<WorkflowTrackingCleanup>;

  constructor(
    private readonly config: ServiceConfig,
    private readonly runtime: AppRuntimeOptions
  ) {
    this.#httpService = createHttpAppService(this.config.server, this.runtime.logSink);
    this.service(this.#httpService.service);
  }

  provider<TArgs extends unknown[] = unknown[], TResult = unknown>(
    key: string,
    handler: ProviderHandler<TArgs, TResult>
  ): AppBuilder {
    if (key.trim() === "") {
      throw new Error("Provider key must be a non-empty string.");
    }
    if (this.#providers.has(key)) {
      throw new Error(`Provider key '${key}' is already registered.`);
    }

    this.#providers.set(key, handler as AnyProvider);
    return this;
  }

  service(handler: AppServiceHandler): AppBuilder {
    this.#services.push(handler);
    return this;
  }

  async listen(): Promise<AppLifecycle> {
    const trackingCleanup = await this.initialize();
    const managedApp = createAppContext({
      config: this.config,
      runtime: this.runtime,
      providers: this.#providers
    });
    managedApp.appContext.on("shutdown", trackingCleanup);
    let shutdownPromise: Promise<void> | undefined;

    try {
      for (const service of this.#services) {
        await service(managedApp.appContext);
      }

      const server = this.#httpService.getServer();
      const shutdown = (): Promise<void> => {
        if (shutdownPromise) {
          return shutdownPromise;
        }

        shutdownPromise = shutdownApp(managedApp.shutdown, () => this.#httpService.waitForIdleRequests());
        return shutdownPromise;
      };

      this.runtime.logSink.info({
        message: "server listening",
        host: this.config.server.host,
        port: this.config.server.port,
        providerKeys: [...this.#providers.keys()],
        serviceCount: this.#services.length
      });

      return {
        server,
        shutdown
      };
    } catch (error) {
      await shutdownApp(managedApp.shutdown, () => this.#httpService.waitForIdleRequests());
      throw error;
    }
  }

  private initialize(): Promise<WorkflowTrackingCleanup> {
    this.#initializePromise ??= initializeWorkflowTracking(this.config, this.runtime);
    return this.#initializePromise;
  }
}

async function shutdownApp(
  shutdownAppContext: () => Promise<void>,
  waitForIdleRequests: () => Promise<void>
): Promise<void> {
  await shutdownAppContext();
  await waitForIdleRequests();
}

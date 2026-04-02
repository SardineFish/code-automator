import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { ProcessRunner } from "../providers/process/process-runner.js";
import type { WorkspaceRepo } from "../repo/workspace/workspace-repo.js";
import { processTriggerSubmission } from "../service/orchestration/process-trigger-submission.js";
import type { WorkflowTracker } from "../service/tracking/workflow-tracker.js";
import type { ServiceConfig } from "../types/config.js";
import type { AppContext, TriggerSubmissionInput } from "../types/runtime.js";
import type { LogSink } from "../types/runtime.js";

export interface AppRuntimeOptions {
  config: ServiceConfig;
  processRunner: ProcessRunner;
  workspaceRepo: WorkspaceRepo;
  workflowTracker: WorkflowTracker;
  logSink: LogSink;
  baseEnv?: NodeJS.ProcessEnv;
}

export type ProviderHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  context: AppContext
) => Promise<void> | void;

export const App = {
  listen(host: string, port: number, options: AppRuntimeOptions): AppBuilder {
    return new AppBuilder(host, port, options);
  }
};

class AppBuilder {
  readonly #providers = new Map<string, ProviderHandler>();

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly options: AppRuntimeOptions
  ) {}

  provider(routePath: string, handler: ProviderHandler): AppBuilder {
    if (!routePath.startsWith("/")) {
      throw new Error(`Provider route '${routePath}' must start with '/'.`);
    }
    if (this.#providers.has(routePath)) {
      throw new Error(`Provider route '${routePath}' is already registered.`);
    }

    this.#providers.set(routePath, handler);
    return this;
  }

  async listen(): Promise<Server> {
    const server = createServer((request, response) => {
      void this.handleRequest(request, response).catch((error) => {
        this.options.logSink.error({
          timestamp: new Date().toISOString(),
          level: "error",
          message: "provider request handling failed",
          errorMessage: error instanceof Error ? error.message : "Unknown request handling error."
        });

        if (!response.headersSent) {
          respond(response, 500, "Internal Server Error");
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.port, this.host, () => {
        server.off("error", reject);
        resolve();
      });
    });

    return server;
  }

  async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const routePath = getRequestPath(request);
    const handler = this.#providers.get(routePath);

    if (!handler) {
      respond(response, 404, "Not Found");
      return;
    }

    const context = createAppContext(routePath, this.options);
    await handler(request, response, context);

    if (!response.headersSent) {
      respond(response, 500, "Provider did not send a response");
    }
  }
}

function createAppContext(routePath: string, options: AppRuntimeOptions): AppContext {
  let submitted = false;
  const triggers = new Map<string, { input: Record<string, unknown>; env: Record<string, string> }>();

  return {
    config: options.config,
    trigger(name, payload) {
      assertTriggerName(name);
      assertTriggerPayload(payload);
      if (submitted) {
        throw new Error("Cannot register triggers after submit().");
      }
      if (triggers.has(name)) {
        throw new Error(`Duplicate trigger '${name}' in one request is not allowed.`);
      }

      triggers.set(name, {
        input: payload.in,
        env: payload.env ?? {}
      });
    },
    submit() {
      if (submitted) {
        throw new Error("submit() may only be called once per request.");
      }
      submitted = true;

      return processTriggerSubmission({
        config: options.config,
        source: routePath,
        triggers: [...triggers.entries()].map(([name, trigger]) => ({
          name,
          input: trigger.input,
          env: trigger.env
        })),
        processRunner: options.processRunner,
        workspaceRepo: options.workspaceRepo,
        workflowTracker: options.workflowTracker,
        logSink: options.logSink,
        baseEnv: options.baseEnv
      });
    }
  };
}

function assertTriggerName(value: string): void {
  if (value.trim() === "") {
    throw new Error("Trigger name must be a non-empty string.");
  }
}

function assertTriggerPayload(payload: TriggerSubmissionInput): void {
  if (!isPlainObject(payload.in)) {
    throw new Error("Trigger input must be a plain object.");
  }
  if (payload.env && !isStringMap(payload.env)) {
    throw new Error("Trigger env must be a string-to-string map.");
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isPlainObject(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function getRequestPath(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://127.0.0.1").pathname;
}

function respond(response: ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
  response.end(body);
}

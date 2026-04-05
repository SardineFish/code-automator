export declare const APP_EXTENSION_API_VERSION: 1;

export type RuntimeLogLevel = "debug" | "info" | "warn" | "error";

export interface RuntimeLogRecord extends Record<string, unknown> {
  message: string;
}

export interface LogSink {
  debug(record: RuntimeLogRecord): void;
  info(record: RuntimeLogRecord): void;
  warn(record: RuntimeLogRecord): void;
  error(record: RuntimeLogRecord): void;
  child(bindings: Record<string, unknown>): LogSink;
  isLevelEnabled(level: RuntimeLogLevel): boolean;
}

export interface TriggerSubmissionInput {
  in: Record<string, unknown>;
  env?: Record<string, string>;
}

export interface WorkflowCompletedEventPayload {
  runId: string;
  workflowName: string;
  matchedTrigger: string;
  executorName: string;
  completedAt: string;
  status: "succeeded";
}

export interface WorkflowErrorEventPayload {
  runId: string;
  workflowName: string;
  matchedTrigger: string;
  executorName: string;
  completedAt: string;
  status: "failed" | "error" | "lost" | "canceled" | "timeout";
  error: Error;
}

export interface WorkflowContextTerminalEventMap {
  completed: WorkflowCompletedEventPayload;
  error: WorkflowErrorEventPayload;
}

export interface OrchestrationResult {
  status: "ignored" | "matched" | "failed";
  reason: string;
  runId?: string;
  pid?: number;
  workflowName?: string;
  matchedTrigger?: string;
  executorName?: string;
  command?: string;
  executionStatus?: string;
  errorMessage?: string;
}

export interface WorkflowContext<TExtensionConfig = unknown> {
  config: Record<string, unknown> & { configDir: string };
  extensionConfig: TExtensionConfig;
  env: NodeJS.ProcessEnv;
  log: LogSink;
  trigger(name: string, payload: TriggerSubmissionInput): void;
  on<T extends keyof WorkflowContextTerminalEventMap>(
    eventName: T,
    listener: (event: WorkflowContextTerminalEventMap[T]) => void | Promise<void>
  ): () => void;
  submit(): Promise<OrchestrationResult>;
}

export type ProviderHandler<
  TArgs extends unknown[] = unknown[],
  TResult = unknown,
  TExtensionConfig = unknown
> = (
  ctx: WorkflowContext<TExtensionConfig>,
  ...args: TArgs
) => Promise<TResult>;

export interface AppContext<TExtensionConfig = unknown> {
  config: Record<string, unknown> & { configDir: string };
  extensionConfig: TExtensionConfig;
  env: NodeJS.ProcessEnv;
  log: LogSink;
  createWorkflow(source: string): WorkflowContext<TExtensionConfig>;
  getProvider<T extends ProviderHandler<any[], unknown>>(key: string): T;
  trackJob<TResult>(debugName: string, job: Promise<TResult>): Promise<TResult>;
  scheduleInterval(
    debugName: string,
    intervalMs: number,
    createJob: () => Promise<unknown>,
    options?: {
      mode?: "skip" | "delay" | "overlap";
      runImmediately?: boolean;
    }
  ): () => void;
  scheduleDelay(
    debugName: string,
    delayMs: number,
    createJob: () => Promise<unknown>
  ): () => void;
  on(eventName: "shutdown", handler: () => Promise<void>): () => void;
}

export type AppServiceHandler<TExtensionConfig = unknown> = (
  app: AppContext<TExtensionConfig>
) => Promise<void>;

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

export const runtimeLogLevels = ["debug", "info", "warn", "error"] as const;

export type RuntimeLogLevel = (typeof runtimeLogLevels)[number];

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

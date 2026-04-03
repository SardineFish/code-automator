import type { LogSink, RuntimeLogLevel, RuntimeLogRecord } from "../../src/types/logging.js";

export interface RecordedLogEntry {
  level: RuntimeLogLevel;
  record: RuntimeLogRecord;
}

export function createNoOpLogSink(): LogSink {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child() {
      return createNoOpLogSink();
    },
    isLevelEnabled() {
      return false;
    }
  };
}

export function createRecordingLogSink(
  entries: RecordedLogEntry[],
  bindings: Record<string, unknown> = {}
): LogSink {
  return {
    debug(record) {
      entries.push({ level: "debug", record: { ...bindings, ...record } });
    },
    info(record) {
      entries.push({ level: "info", record: { ...bindings, ...record } });
    },
    warn(record) {
      entries.push({ level: "warn", record: { ...bindings, ...record } });
    },
    error(record) {
      entries.push({ level: "error", record: { ...bindings, ...record } });
    },
    child(childBindings) {
      return createRecordingLogSink(entries, { ...bindings, ...childBindings });
    },
    isLevelEnabled() {
      return false;
    }
  };
}

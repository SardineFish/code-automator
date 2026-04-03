import type { LogSink, RuntimeLogLevel, RuntimeLogRecord } from "../../src/types/logging.js";

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

export interface CapturedLogRecord extends RuntimeLogRecord {
  level: RuntimeLogLevel;
}

export function createMemoryLogSink(
  records: CapturedLogRecord[],
  bindings: Record<string, unknown> = {}
): LogSink {
  function write(level: RuntimeLogLevel, record: RuntimeLogRecord): void {
    records.push({
      ...bindings,
      ...record,
      level
    });
  }

  return {
    debug(record) {
      write("debug", record);
    },
    info(record) {
      write("info", record);
    },
    warn(record) {
      write("warn", record);
    },
    error(record) {
      write("error", record);
    },
    child(childBindings) {
      return createMemoryLogSink(records, { ...bindings, ...childBindings });
    },
    isLevelEnabled() {
      return false;
    }
  };
}

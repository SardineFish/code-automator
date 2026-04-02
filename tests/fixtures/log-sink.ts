import type { LogSink } from "../../src/types/logging.js";

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

import type { LogSink } from "../../types/runtime.js";

export const consoleJsonLogSink: LogSink = {
  info(record) {
    process.stdout.write(`${JSON.stringify(record)}\n`);
  },
  error(record) {
    process.stderr.write(`${JSON.stringify(record)}\n`);
  }
};

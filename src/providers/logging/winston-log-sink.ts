import { createLogger, format, transports, type Logger } from "winston";

import type { LogSink, RuntimeLogLevel, RuntimeLogRecord } from "../../types/logging.js";
import { formatHumanLogEntry } from "./format-human-log.js";

export function createConsoleLogSink(level: RuntimeLogLevel): LogSink {
  const logger = createLogger({
    level,
    format: format.combine(
      format.errors({ stack: true }),
      format.timestamp(),
      format.printf((info) =>
        formatHumanLogEntry(info as Record<string, unknown> & { message: string; timestamp?: string; level?: string })
      )
    ),
    transports: [
      new transports.Console({
        stderrLevels: ["warn", "error"]
      })
    ]
  });

  return createLogSink(logger);
}

function createLogSink(logger: Logger): LogSink {
  return {
    debug(record) {
      writeLog(logger, "debug", record);
    },
    info(record) {
      writeLog(logger, "info", record);
    },
    warn(record) {
      writeLog(logger, "warn", record);
    },
    error(record) {
      writeLog(logger, "error", record);
    },
    child(bindings) {
      return createLogSink(logger.child(bindings));
    },
    isLevelEnabled(level) {
      return logger.isLevelEnabled(level);
    }
  };
}

function writeLog(logger: Logger, level: RuntimeLogLevel, record: RuntimeLogRecord): void {
  const { message, ...meta } = record;
  logger.log(level, message, meta);
}

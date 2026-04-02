import type { WorkflowRunArtifacts } from "../../types/tracking.js";

export function buildDetachedWrapperScript(
  command: string,
  options: { timeoutMs?: number; artifacts: WorkflowRunArtifacts }
): string {
  const timeoutSeconds = options.timeoutMs ? String(options.timeoutMs / 1000) : "";
  const commandLiteral = toShellLiteral(command);
  const stdoutPath = toShellLiteral(options.artifacts.stdoutPath);
  const stderrPath = toShellLiteral(options.artifacts.stderrPath);
  const pidFilePath = toShellLiteral(options.artifacts.pidFilePath);
  const resultFilePath = toShellLiteral(options.artifacts.resultFilePath);

  return `#!/bin/sh
set +e

COMMAND=${commandLiteral}
STDOUT_PATH=${stdoutPath}
STDERR_PATH=${stderrPath}
PID_FILE=${pidFilePath}
RESULT_FILE=${resultFilePath}
RESULT_TMP_FILE="$RESULT_FILE.tmp"
TIMEOUT_SECONDS=${timeoutSeconds === "" ? "''" : toShellLiteral(timeoutSeconds)}

/bin/sh -lc "$COMMAND" >>"$STDOUT_PATH" 2>>"$STDERR_PATH" &
COMMAND_PID=$!
printf '%s\\n' "$COMMAND_PID" > "$PID_FILE"
TIMEOUT_FILE="$RESULT_FILE.timeout"
SIGNAL_FILE="$RESULT_FILE.signal"
WATCHER_PID=""

if [ -n "$TIMEOUT_SECONDS" ]; then
  (
    sleep "$TIMEOUT_SECONDS"
    if kill -0 "$COMMAND_PID" 2>/dev/null; then
      printf 'true' > "$TIMEOUT_FILE"
      printf 'SIGTERM' > "$SIGNAL_FILE"
      kill -TERM "$COMMAND_PID" 2>/dev/null
      sleep "1"
      if kill -0 "$COMMAND_PID" 2>/dev/null; then
        printf 'SIGKILL' > "$SIGNAL_FILE"
        kill -KILL "$COMMAND_PID" 2>/dev/null
      fi
    fi
  ) &
  WATCHER_PID=$!
fi

wait "$COMMAND_PID"
EXIT_CODE=$?

if [ -n "$WATCHER_PID" ]; then
  kill "$WATCHER_PID" 2>/dev/null
  wait "$WATCHER_PID" 2>/dev/null
fi

SIGNAL_JSON="null"
if [ -f "$SIGNAL_FILE" ]; then
  SIGNAL_VALUE=$(cat "$SIGNAL_FILE")
  SIGNAL_JSON="\\\"$SIGNAL_VALUE\\\""
fi

TIMED_OUT_JSON="false"
if [ -f "$TIMEOUT_FILE" ]; then
  TIMED_OUT_JSON="true"
fi

COMPLETED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
printf '{"pid":%s,"exitCode":%s,"signal":%s,"stdout":"","stderr":"","stdoutPath":"%s","stderrPath":"%s","timedOut":%s,"completedAt":"%s"}\\n' "$COMMAND_PID" "$EXIT_CODE" "$SIGNAL_JSON" "$STDOUT_PATH" "$STDERR_PATH" "$TIMED_OUT_JSON" "$COMPLETED_AT" > "$RESULT_TMP_FILE"
mv "$RESULT_TMP_FILE" "$RESULT_FILE"
rm -f "$TIMEOUT_FILE" "$SIGNAL_FILE"
`;
}

export function isErrnoException(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === code;
}

function toShellLiteral(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

interface HumanLogEntry extends Record<string, unknown> {
  timestamp?: string;
  level?: string;
  message: string;
}

const INLINE_STRING_PATTERN = /^[A-Za-z0-9_./:=,@+-]+$/;
const MULTILINE_THRESHOLD = 80;

export function formatHumanLogEntry(entry: HumanLogEntry): string {
  const parts = [entry.timestamp ?? new Date().toISOString(), entry.level ?? "info", entry.message];
  const detailLines: string[] = [];

  for (const [key, value] of Object.entries(entry)) {
    if (value === undefined || key === "timestamp" || key === "level" || key === "message") {
      continue;
    }

    const rendered = renderValue(value);

    if (rendered.includes("\n") || rendered.length > MULTILINE_THRESHOLD) {
      for (const line of rendered.split("\n")) {
        detailLines.push(`  ${key}: ${line}`);
      }
      continue;
    }

    parts.push(`${key}=${renderInlineValue(rendered)}`);
  }

  return detailLines.length === 0 ? parts.join(" ") : `${parts.join(" ")}\n${detailLines.join("\n")}`;
}

function renderValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderValue(item)).join(",");
  }
  if (value === null) {
    return "null";
  }

  return JSON.stringify(value);
}

function renderInlineValue(value: string): string {
  if (value === "") {
    return '""';
  }

  return INLINE_STRING_PATTERN.test(value)
    ? value
    : `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

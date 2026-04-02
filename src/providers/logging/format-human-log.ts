interface HumanLogEntry extends Record<string, unknown> {
  timestamp?: string;
  level?: string;
  message: string;
}

const INLINE_STRING_PATTERN = /^[A-Za-z0-9_./:=,@+-]+$/;
const MULTILINE_THRESHOLD = 80;
const timestampFormatters = new Map<string, Intl.DateTimeFormat>();

export function formatHumanLogEntry(entry: HumanLogEntry, timeZone = getLocalTimeZone()): string {
  const parts = [`[${formatLocalTimestamp(entry.timestamp, timeZone)}][${entry.level ?? "info"}]`, entry.message];
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

export function formatLocalTimestamp(timestamp?: string, timeZone = getLocalTimeZone()): string {
  if (timestamp === undefined) {
    return formatTimestampParts(new Date(), timeZone);
  }

  const parsed = new Date(timestamp);

  return Number.isNaN(parsed.getTime()) ? timestamp : formatTimestampParts(parsed, timeZone);
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

function formatTimestampParts(date: Date, timeZone: string): string {
  const parts = getTimestampFormatter(timeZone).formatToParts(date);

  return [
    `${requirePart(parts, "year")}-${requirePart(parts, "month")}-${requirePart(parts, "day")}`,
    `T${requirePart(parts, "hour")}:${requirePart(parts, "minute")}:${requirePart(parts, "second")}.${requirePart(parts, "fractionalSecond")}`,
    normalizeOffset(requirePart(parts, "timeZoneName"))
  ].join("");
}

function getTimestampFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = timestampFormatters.get(timeZone);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hourCycle: "h23",
    timeZoneName: "longOffset"
  });

  timestampFormatters.set(timeZone, formatter);

  return formatter;
}

function requirePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const match = parts.find((part) => part.type === type)?.value;

  if (!match) {
    throw new Error(`Missing timestamp part: ${type}`);
  }

  return match;
}

function normalizeOffset(offset: string): string {
  return offset === "GMT" ? "+00:00" : offset.replace("GMT", "");
}

function getLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

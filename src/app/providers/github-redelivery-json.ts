import { readString } from "./github-utils.js";

export function parseGitHubDeliveryJson(text: string): unknown {
  const deliveryIds = readDeliveryIds(text);
  const parsed = JSON.parse(text) as unknown;

  assignDeliveryIds(parsed, deliveryIds, { index: 0 });

  return parsed;
}

function readDeliveryIds(text: string): string[] {
  return readValue(text, skipWhitespace(text, 0)).deliveryIds;
}

function readValue(text: string, index: number): { deliveryIds: string[]; next: number } {
  const char = text[index];

  if (char === "{") {
    return readObject(text, index + 1);
  }

  if (char === "[") {
    return readArray(text, index + 1);
  }

  if (char === "\"") {
    return { deliveryIds: [], next: readStringTokenEnd(text, index) };
  }

  return { deliveryIds: [], next: readScalarEnd(text, index) };
}

function readArray(text: string, index: number): { deliveryIds: string[]; next: number } {
  const deliveryIds: string[] = [];
  let next = skipWhitespace(text, index);

  if (text[next] === "]") {
    return { deliveryIds, next: next + 1 };
  }

  while (next < text.length) {
    const value = readValue(text, next);
    deliveryIds.push(...value.deliveryIds);
    next = skipWhitespace(text, value.next);

    if (text[next] === "]") {
      return { deliveryIds, next: next + 1 };
    }

    next = skipWhitespace(text, next + 1);
  }

  throw new Error("Invalid GitHub delivery JSON array.");
}

function readObject(text: string, index: number): { deliveryIds: string[]; next: number } {
  const deliveryIds: string[] = [];
  let next = skipWhitespace(text, index);
  let deliveryId: string | undefined;
  let hasGuid = false;
  let hasDeliveredAt = false;

  if (text[next] === "}") {
    return { deliveryIds, next: next + 1 };
  }

  while (next < text.length) {
    const keyEnd = readStringTokenEnd(text, next);
    const key = JSON.parse(text.slice(next, keyEnd)) as string;
    next = skipWhitespace(text, keyEnd);

    if (text[next] !== ":") {
      throw new Error("Invalid GitHub delivery JSON object.");
    }

    next = skipWhitespace(text, next + 1);

    if (key === "id" && isIntegerStart(text[next])) {
      const valueEnd = readScalarEnd(text, next);
      deliveryId = text.slice(next, valueEnd);
      next = valueEnd;
    } else {
      const value = readValue(text, next);
      if (key === "guid" && isJSONString(text, next)) {
        hasGuid = true;
      }
      if (key === "delivered_at" && isJSONString(text, next)) {
        hasDeliveredAt = true;
      }
      deliveryIds.push(...value.deliveryIds);
      next = value.next;
    }

    next = skipWhitespace(text, next);

    if (text[next] === "}") {
      if (deliveryId && hasGuid && hasDeliveredAt) {
        deliveryIds.unshift(deliveryId);
      }

      return { deliveryIds, next: next + 1 };
    }

    next = skipWhitespace(text, next + 1);
  }

  throw new Error("Invalid GitHub delivery JSON object.");
}

function assignDeliveryIds(value: unknown, deliveryIds: string[], state: { index: number }): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      assignDeliveryIds(entry, deliveryIds, state);
    }
    return;
  }

  if (!isGitHubDeliveryRecord(value)) {
    return;
  }

  const deliveryId = deliveryIds[state.index];

  if (deliveryId) {
    value.id = deliveryId;
    state.index += 1;
  }

  for (const nested of Object.values(value)) {
    assignDeliveryIds(nested, deliveryIds, state);
  }
}

function isGitHubDeliveryRecord(value: unknown): value is Record<string, unknown> & { id?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof readString(value as Record<string, unknown>, "guid") === "string" &&
    typeof readString(value as Record<string, unknown>, "delivered_at") === "string"
  );
}

function skipWhitespace(text: string, index: number): number {
  let next = index;

  while (next < text.length && /\s/.test(text[next] ?? "")) {
    next += 1;
  }

  return next;
}

function readStringTokenEnd(text: string, index: number): number {
  let next = index + 1;
  let escaped = false;

  while (next < text.length) {
    const char = text[next];

    if (!escaped && char === "\"") {
      return next + 1;
    }

    escaped = !escaped && char === "\\";
    next += 1;
  }

  throw new Error("Invalid GitHub delivery JSON string.");
}

function readScalarEnd(text: string, index: number): number {
  let next = index;

  while (next < text.length && !/[,\]\}\s]/.test(text[next] ?? "")) {
    next += 1;
  }

  return next;
}

function isJSONString(text: string, index: number): boolean {
  return text[index] === "\"";
}

function isIntegerStart(char: string | undefined): boolean {
  return char !== undefined && /[0-9-]/.test(char);
}

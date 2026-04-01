export function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function readObject(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  return asObject(value[key]);
}

export function readString(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

export function readNumber(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

export function readInteger(value: Record<string, unknown>, key: string): number | undefined {
  const numberValue = readNumber(value, key);
  return numberValue !== undefined && Number.isInteger(numberValue) ? numberValue : undefined;
}

export function readBoolean(value: Record<string, unknown>, key: string): boolean | undefined {
  const field = value[key];
  return typeof field === "boolean" ? field : undefined;
}

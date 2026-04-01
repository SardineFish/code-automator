export function toShellLiteral(value: string, options?: { allowEmpty?: boolean }): string {
  if (value === "" && options?.allowEmpty) {
    return "";
  }

  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

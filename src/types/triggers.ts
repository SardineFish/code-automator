export type TriggerKey = string;

export function isTriggerKey(value: string): value is TriggerKey {
  return value.trim() !== "";
}

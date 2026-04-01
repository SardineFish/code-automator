const CORE_TRIGGER_KEYS = new Set<CoreTriggerKey>([
  "issue:open",
  "issue:comment",
  "pr:comment",
  "pr:review"
]);

export type CoreTriggerKey = "issue:open" | "issue:comment" | "pr:comment" | "pr:review";
export type CommandTriggerKey = `issue:command:${string}`;
export type TriggerKey = CoreTriggerKey | CommandTriggerKey;

export function isTriggerKey(value: string): value is TriggerKey {
  if (CORE_TRIGGER_KEYS.has(value as CoreTriggerKey)) {
    return true;
  }

  return /^issue:command:[a-z0-9][a-z0-9-]*$/.test(value);
}

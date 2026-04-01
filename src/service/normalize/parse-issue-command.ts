import type { CommandInput } from "../../types/workflow-input.js";

const SUPPORTED_COMMANDS = new Set(["plan", "approve", "go", "implement", "code"]);

export interface IssueMentionParseResult {
  hasMention: boolean;
  command?: CommandInput;
  content: string;
}

export function parseIssueMention(bodyText: string, botHandle: string): IssueMentionParseResult {
  const mentionPattern = new RegExp(`^\\s*@${escapeRegex(botHandle)}\\b\\s*(.*)$`, "i");
  const mentionMatch = bodyText.match(mentionPattern);

  if (!mentionMatch) {
    return { hasMention: false, content: bodyText };
  }

  const remainder = (mentionMatch[1] ?? "").trim();
  if (remainder === "") {
    return { hasMention: true, content: "" };
  }

  const commandMatch = remainder.match(/^\/?([a-z0-9-]+)\b\s*(.*)$/i);

  if (!commandMatch) {
    return { hasMention: true, content: remainder };
  }

  const commandName = commandMatch[1].toLowerCase();
  const argsText = (commandMatch[2] ?? "").trim();

  if (!SUPPORTED_COMMANDS.has(commandName)) {
    return { hasMention: true, content: remainder };
  }

  return {
    hasMention: true,
    content: remainder,
    command: {
      name: commandName,
      invokedWithSlash: remainder.startsWith("/"),
      argsText: argsText === "" ? undefined : argsText,
      bodyText,
      mentionPrefix: `@${botHandle}`
    }
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

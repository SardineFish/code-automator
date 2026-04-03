import { readString } from "./github-utils.js";

export function parseGitHubDeliveryJson(text: string): unknown {
  return JSON.parse(
    text,
    function preserveDeliveryId(this: unknown, key: string, value: unknown, context?: { source: string }) {
      if (key !== "id" || typeof value !== "number" || !context?.source || !isGitHubDeliveryRecord(this)) {
        return value;
      }

      return context.source;
    }
  ) as unknown;
}

function isGitHubDeliveryRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof readString(value as Record<string, unknown>, "guid") === "string" &&
    typeof readString(value as Record<string, unknown>, "delivered_at") === "string"
  );
}

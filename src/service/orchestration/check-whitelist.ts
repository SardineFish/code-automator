import type { ServiceConfig } from "../../types/config.js";
import type { WebhookGateContext } from "../../types/runtime.js";

export function getWhitelistRejectionReason(
  config: ServiceConfig,
  gate: WebhookGateContext
): string | null {
  const repoAllowed = config.whitelist.repo.some(
    (repo) => repo.toLowerCase() === gate.repoFullName.toLowerCase()
  );

  if (!repoAllowed) {
    return "repo_not_whitelisted";
  }

  const userAllowed = config.whitelist.user.some(
    (user) => user.toLowerCase() === gate.actorLogin.toLowerCase()
  );

  if (!userAllowed) {
    return "actor_not_whitelisted";
  }

  return null;
}

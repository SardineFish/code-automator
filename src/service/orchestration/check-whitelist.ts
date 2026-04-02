import type { WhitelistConfig } from "../../types/config.js";
import type { WebhookGateContext } from "../../types/runtime.js";

export function getWhitelistRejectionReason(
  whitelist: WhitelistConfig,
  gate: WebhookGateContext
): string | null {
  const repoAllowed = whitelist.repo.some(
    (repo) => repo.toLowerCase() === gate.repoFullName.toLowerCase()
  );

  if (!repoAllowed) {
    return "repo_not_whitelisted";
  }

  const userAllowed = whitelist.user.some(
    (user) => user.toLowerCase() === gate.actorLogin.toLowerCase()
  );

  if (!userAllowed) {
    return "actor_not_whitelisted";
  }

  return null;
}

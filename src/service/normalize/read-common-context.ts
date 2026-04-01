import type { WebhookGateContext } from "../../types/runtime.js";
import type { WorkflowTemplateInput } from "../../types/workflow-input.js";
import { readBoolean, readInteger, readObject, readString } from "./payload-readers.js";

export interface CommonContext {
  gate: WebhookGateContext;
  repository: WorkflowTemplateInput["repository"];
  actor: WorkflowTemplateInput["actor"];
  installation: { id: number };
  organization?: { login?: string; id?: number };
  enterprise?: { slug?: string; id?: number };
}

export function readCommonContext(payload: Record<string, unknown>): CommonContext | null {
  const repository = readObject(payload, "repository");
  const sender = readObject(payload, "sender");
  const installation = readObject(payload, "installation");

  if (!repository || !sender || !installation) {
    return null;
  }

  const repoFullName = readString(repository, "full_name");
  const repoName = readString(repository, "name");
  const owner = readObject(repository, "owner");
  const ownerLogin = owner ? readString(owner, "login") : undefined;
  const actorLogin = readString(sender, "login");
  const actorId = readInteger(sender, "id");
  const installationId = readInteger(installation, "id");

  if (!repoFullName || !repoName || !ownerLogin || !actorLogin || actorId === undefined || installationId === undefined) {
    return null;
  }

  const organization = readObject(payload, "organization");
  const enterprise = readObject(payload, "enterprise");

  return {
    gate: { repoFullName, actorLogin, installationId },
    repository: {
      owner: ownerLogin,
      name: repoName,
      fullName: repoFullName,
      defaultBranch: readString(repository, "default_branch"),
      private: readBoolean(repository, "private"),
      url: readString(repository, "html_url") ?? readString(repository, "url")
    },
    actor: {
      login: actorLogin,
      id: actorId,
      type: readString(sender, "type"),
      url: readString(sender, "html_url") ?? readString(sender, "url")
    },
    installation: { id: installationId },
    organization: organization
      ? { login: readString(organization, "login"), id: readInteger(organization, "id") }
      : undefined,
    enterprise: enterprise
      ? { slug: readString(enterprise, "slug"), id: readInteger(enterprise, "id") }
      : undefined
  };
}

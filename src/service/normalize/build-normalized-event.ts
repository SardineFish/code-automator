import type { TriggerKey } from "../../types/triggers.js";
import type { NormalizedWebhookEvent } from "../../types/runtime.js";
import type {
  CommentInput,
  CommandInput,
  PullRequestInput,
  ReviewInput,
  SubjectInput,
  WorkflowTemplateInput
} from "../../types/workflow-input.js";
import { asObject, readString } from "./payload-readers.js";
import type { CommonContext } from "./read-common-context.js";
import type { NormalizeWebhookInput } from "./normalize-webhook-event.js";

export interface NormalizedDetails {
  issue?: WorkflowTemplateInput["issue"];
  pullRequest?: PullRequestInput;
  comment?: CommentInput;
  review?: ReviewInput;
  command?: CommandInput;
}

export function buildNormalizedEvent(
  input: NormalizeWebhookInput,
  common: CommonContext,
  candidateTriggers: TriggerKey[],
  subject: SubjectInput,
  details: NormalizedDetails,
  content: string
): NormalizedWebhookEvent {
  const payload = asObject(input.payload) ?? {};
  const action = readString(payload, "action");
  const templateInput: WorkflowTemplateInput = {
    event: { name: input.eventName, action, deliveryId: input.deliveryId, candidateTriggers },
    repository: common.repository,
    actor: common.actor,
    installation: common.installation,
    subject,
    message: { text: content },
    organization: common.organization,
    enterprise: common.enterprise,
    issue: details.issue,
    pullRequest: details.pullRequest,
    comment: details.comment,
    review: details.review,
    command: details.command,
    repo: common.repository.fullName,
    repoOwner: common.repository.owner,
    repoName: common.repository.name,
    actorLogin: common.actor.login,
    content,
    subjectKind: subject.kind,
    subjectNumber: subject.number,
    subjectTitle: subject.title,
    subjectBody: subject.body,
    subjectUrl: subject.url,
    issueNumber: details.issue?.number,
    prNumber: subject.kind === "pull_request" ? subject.number : undefined,
    commentBody: details.comment?.body,
    reviewState: details.review?.state,
    commandName: details.command?.name,
    eventName: input.eventName,
    eventAction: action
  };

  return {
    deliveryId: input.deliveryId,
    eventName: input.eventName,
    action,
    candidateTriggers,
    input: templateInput,
    gate: common.gate
  };
}

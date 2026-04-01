import type { TriggerKey } from "./triggers.js";

export type SubjectKind = "issue" | "pull_request";

export interface WorkflowEventInput {
  name: string;
  action?: string;
  deliveryId?: string;
  candidateTriggers?: TriggerKey[];
  matchedTrigger?: TriggerKey;
}

export interface RepositoryInput {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch?: string;
  private?: boolean;
  url?: string;
}

export interface ActorInput {
  login: string;
  id: number;
  type?: string;
  url?: string;
}

export interface SubjectInput {
  kind: SubjectKind;
  number: number;
  title?: string;
  body?: string;
  state?: string;
  url?: string;
  authorLogin?: string;
}

export interface IssueInput {
  number: number;
  title?: string;
  body?: string;
  state?: string;
  url?: string;
}

export interface PullRequestInput {
  number: number;
  title?: string;
  body?: string;
  state?: string;
  url?: string;
}

export interface CommentInput {
  id?: number;
  body?: string;
  url?: string;
}

export interface ReviewInput {
  id?: number;
  body?: string;
  state?: string;
  url?: string;
}

export interface CommandInput {
  name: string;
  invokedWithSlash: boolean;
  argsText?: string;
  bodyText: string;
  mentionPrefix: string;
}

export interface MessageInput {
  text: string;
}

export interface WorkflowTemplateInput {
  event: WorkflowEventInput;
  repository: RepositoryInput;
  actor: ActorInput;
  installation: { id: number };
  subject: SubjectInput;
  message: MessageInput;
  organization?: { login?: string; id?: number };
  enterprise?: { slug?: string; id?: number };
  issue?: IssueInput;
  pullRequest?: PullRequestInput;
  comment?: CommentInput;
  review?: ReviewInput;
  command?: CommandInput;
  repo: string;
  repoOwner: string;
  repoName: string;
  actorLogin: string;
  content: string;
  subjectKind: SubjectKind;
  subjectNumber: number;
  subjectTitle?: string;
  subjectBody?: string;
  subjectUrl?: string;
  issueNumber?: number;
  prNumber?: number;
  commentBody?: string;
  reviewState?: string;
  commandName?: string;
  eventName: string;
  eventAction?: string;
}

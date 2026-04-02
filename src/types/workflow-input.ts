export interface WorkflowInput {
  event: string;
  [key: string]: unknown;
}

export type GitHubReview = "approve" | "request-changes";

export interface GitHubInput extends WorkflowInput {
  issueId?: string;
  prId?: string;
  content?: string;
  prReview?: GitHubReview;
  user: string;
  command?: string;
}

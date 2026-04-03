import type { IncomingMessage, ServerResponse } from "node:http";
import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

import { RequestBodyError, readRequestBody } from "../../runtime/http/read-request-body.js";
import type { WebhookGateContext } from "../../types/runtime.js";
import type { WorkflowRunReactionTarget } from "../../types/tracking.js";
import type { GitHubReview } from "../../types/workflow-input.js";

const SUPPORTED_COMMANDS = new Set(["plan", "approve"]);
const installationTokenProviders = new Map<string, InstallationTokenProvider>();
const appJwtProviders = new Map<string, GitHubAppJwtProvider>();

export interface IssueMentionParseResult {
  hasMention: boolean;
  command?: string;
  content: string;
}

export interface GitHubReaction {
  content: string;
  userLogin?: string;
  userType?: string;
}

export function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function readObject(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  return asObject(value[key]);
}

export function readString(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

export function readInteger(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  return typeof field === "number" && Number.isInteger(field) ? field : undefined;
}

export function parseCommentMention(bodyText: string, botHandle: string): Omit<IssueMentionParseResult, "command"> {
  const leadingMentionContent = readLeadingMentionContent(bodyText, botHandle);

  return {
    hasMention: hasBotMention(bodyText, botHandle),
    content: leadingMentionContent ?? bodyText.trim()
  };
}

export function parseIssueMention(
  bodyText: string,
  botHandle: string,
  requireMention = true
): IssueMentionParseResult {
  const mention = parseCommentMention(bodyText, botHandle);
  const leadingMentionContent = readLeadingMentionContent(bodyText, botHandle);
  const commandSource = leadingMentionContent ?? (requireMention ? undefined : bodyText.trim());

  return {
    ...mention,
    command: readSupportedSlashCommand(commandSource)
  };
}

export async function readBody(request: IncomingMessage, response: ServerResponse): Promise<Buffer | null> {
  try {
    return await readRequestBody(request);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      respond(response, error.statusCode, error.message);
      return null;
    }
    throw error;
  }
}

export function readPayload(body: Buffer, response: ServerResponse): Record<string, unknown> | null {
  try {
    const payload = asObject(JSON.parse(body.toString("utf8")));
    if (!payload) {
      respond(response, 400, "Invalid JSON");
      return null;
    }
    return payload;
  } catch {
    respond(response, 400, "Invalid JSON");
    return null;
  }
}

export function readGate(payload: Record<string, unknown>): WebhookGateContext | null {
  const repository = readObject(payload, "repository");
  const sender = readObject(payload, "sender");
  const installation = readObject(payload, "installation");
  const repoFullName = readString(repository ?? {}, "full_name");
  const actorLogin = readString(sender ?? {}, "login");
  const installationId = readInteger(installation ?? {}, "id");

  return repoFullName && actorLogin && installationId !== undefined
    ? { repoFullName, actorLogin, installationId }
    : null;
}

export function readId(value: Record<string, unknown> | null): string | undefined {
  const number = readInteger(value ?? {}, "number");
  return number === undefined ? undefined : String(number);
}

export function mapReviewState(state: string | undefined): GitHubReview | undefined {
  if (state === "approved") {
    return "approve";
  }
  if (state === "changes_requested") {
    return "request-changes";
  }
  return undefined;
}

export function getHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function getInstallationTokenProvider(privateKeyPath: string): InstallationTokenProvider {
  let provider = installationTokenProviders.get(privateKeyPath);
  if (!provider) {
    provider = createInstallationTokenProvider(privateKeyPath, fetchGitHubInstallationTokenClient);
    installationTokenProviders.set(privateKeyPath, provider);
  }
  return provider;
}

export function getGitHubAppJwtProvider(privateKeyPath: string): GitHubAppJwtProvider {
  let provider = appJwtProviders.get(privateKeyPath);
  if (!provider) {
    provider = createGitHubAppJwtProvider(privateKeyPath);
    appJwtProviders.set(privateKeyPath, provider);
  }

  return provider;
}

export function requireEnv(env: NodeJS.ProcessEnv, key: "GITHUB_WEBHOOK_SECRET" | "GITHUB_APP_PRIVATE_KEY_PATH"): string {
  const value = env[key];
  if (!value || value.trim() === "") {
    throw new Error(`Missing ${key} in runtime environment.`);
  }
  return value;
}

export function respond(response: ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
  response.end(body);
}

export type GitHubReactionListTarget = Exclude<WorkflowRunReactionTarget, { kind: "pull_request_review" }>;

export async function addGitHubReaction(options: {
  repoFullName: string;
  reaction: "eyes" | "rocket";
  token: string;
  target: WorkflowRunReactionTarget;
}): Promise<void> {
  if (options.target.kind === "pull_request_review") {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: createGitHubApiHeaders(options.token, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        query: `
          mutation AddReaction($subjectId: ID!, $content: ReactionContent!) {
            addReaction(input: { subjectId: $subjectId, content: $content }) {
              reaction {
                content
              }
            }
          }
        `,
        variables: {
          subjectId: options.target.nodeId,
          content: mapGraphqlReaction(options.reaction)
        }
      })
    });

    if (response.ok) {
      return;
    }

    const body = await response.text();
    throw new Error(`GitHub reaction request failed: ${response.status} ${body}`);
  }

  const response = await fetch(getReactionEndpoint(options.repoFullName, options.target.subjectId, options.target.kind), {
    method: "POST",
    headers: createGitHubApiHeaders(options.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ content: options.reaction })
  });

  if (response.status === 200 || response.status === 201) {
    return;
  }

  const body = await response.text();
  throw new Error(`GitHub reaction request failed: ${response.status} ${body}`);
}

export async function listCommentReactions(options: {
  repoFullName: string;
  subjectId: number;
  token: string;
  kind: GitHubReactionListTarget["kind"];
}): Promise<GitHubReaction[]> {
  const response = await fetch(`${getReactionEndpoint(options.repoFullName, options.subjectId, options.kind)}?per_page=100`, {
    headers: createGitHubApiHeaders(options.token)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub reaction list request failed: ${response.status} ${body}`);
  }

  const payload = (await response.json()) as unknown;

  if (!Array.isArray(payload)) {
    throw new Error("GitHub reaction list response did not return an array.");
  }

  return payload.flatMap((value) => {
    const reaction = asObject(value);

    if (!reaction) {
      return [];
    }

    const content = readString(reaction, "content");

    if (!content) {
      return [];
    }

    const user = readObject(reaction, "user");
    return [
      {
        content,
        userLogin: readString(user ?? {}, "login"),
        userType: readString(user ?? {}, "type")
      }
    ];
  });
}

export async function addThreadComment(options: {
  repoFullName: string;
  subjectId: number;
  body: string;
  token: string;
  kind: "issue" | "pull_request";
}): Promise<void> {
  const [owner, repo] = splitRepoFullName(options.repoFullName);

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${options.subjectId}/comments`, {
    method: "POST",
    headers: createGitHubApiHeaders(options.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ body: options.body })
  });

  if (response.status === 200 || response.status === 201) {
    return;
  }

  const body = await response.text();
  throw new Error(`GitHub ${options.kind} comment request failed: ${response.status} ${body}`);
}

export async function readGitHubThreadState(options: {
  repoFullName: string;
  subjectId: number;
  token: string;
  kind: "issue" | "pull_request";
}): Promise<string | undefined> {
  const [owner, repo] = splitRepoFullName(options.repoFullName);
  const endpoint =
    options.kind === "issue"
      ? `https://api.github.com/repos/${owner}/${repo}/issues/${options.subjectId}`
      : `https://api.github.com/repos/${owner}/${repo}/pulls/${options.subjectId}`;
  const response = await fetch(endpoint, {
    headers: createGitHubApiHeaders(options.token)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub ${options.kind} state request failed: ${response.status} ${body}`);
  }

  const payload = asObject((await response.json()) as unknown);

  if (!payload) {
    throw new Error(`GitHub ${options.kind} state response did not return an object.`);
  }

  return readString(payload, "state");
}

export interface InstallationTokenProvider {
  createInstallationToken(clientId: string, installationId: number): Promise<string>;
}

export interface GitHubAppJwtProvider {
  createAppJwt(clientId: string): Promise<string>;
}

export function createInstallationTokenProvider(
  privateKeyPath: string,
  client: GitHubInstallationTokenClient
): InstallationTokenProvider {
  const jwtProvider = createGitHubAppJwtProvider(privateKeyPath);

  return {
    async createInstallationToken(clientId, installationId) {
      const jwt = await jwtProvider.createAppJwt(clientId);
      const response = await client.createInstallationAccessToken(jwt, installationId);
      return response.token;
    }
  };
}

export function createGitHubAppJwtProvider(privateKeyPath: string): GitHubAppJwtProvider {
  let privateKeyPromise: Promise<string> | undefined;

  return {
    async createAppJwt(clientId) {
      privateKeyPromise ??= loadPrivateKey(privateKeyPath);
      const privateKey = await privateKeyPromise;
      return generateGitHubAppJwt(clientId, privateKey);
    }
  };
}

export function generateGitHubAppJwt(clientId: string, privateKeyPem: string, now = new Date()): string {
  const issuedAt = Math.floor(now.getTime() / 1000) - 60;
  const expiresAt = issuedAt + (9 * 60);
  const encodedHeader = encodeJwtPart({ alg: "RS256", typ: "JWT" });
  const encodedPayload = encodeJwtPart({ iat: issuedAt, exp: expiresAt, iss: clientId });
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign("RSA-SHA256");

  signer.update(unsignedToken);
  signer.end();

  const signature = signer.sign(privateKeyPem).toString("base64url");

  return `${unsignedToken}.${signature}`;
}

async function loadPrivateKey(privateKeyPath: string): Promise<string> {
  return readFile(privateKeyPath, "utf8");
}

function encodeJwtPart(value: Record<string, number | string>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export interface InstallationTokenResponse {
  token: string;
  expiresAt?: string;
}

export interface GitHubInstallationTokenClient {
  createInstallationAccessToken(jwt: string, installationId: number): Promise<InstallationTokenResponse>;
}

export const fetchGitHubInstallationTokenClient: GitHubInstallationTokenClient = {
  async createInstallationAccessToken(jwt, installationId) {
    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: createGitHubApiHeaders(jwt)
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub installation token request failed: ${response.status} ${body}`);
    }

    const payload = (await response.json()) as { token?: string; expires_at?: string };

    if (!payload.token) {
      throw new Error("GitHub installation token response did not include a token.");
    }

    return { token: payload.token, expiresAt: payload.expires_at };
  }
};

function createGitHubApiHeaders(
  token: string,
  extraHeaders?: Record<string, string>
): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "github-agent-orchestrator",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extraHeaders
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasBotMention(bodyText: string, botHandle: string): boolean {
  return new RegExp(`(^|[^a-z0-9-])@${escapeRegex(botHandle)}(?![a-z0-9-])`, "i").test(bodyText);
}

function readLeadingMentionContent(bodyText: string, botHandle: string): string | undefined {
  const mentionPattern = new RegExp(`^\\s*@${escapeRegex(botHandle)}(?=\\s|$)\\s*(.*)$`, "si");
  const mentionMatch = bodyText.match(mentionPattern);

  if (!mentionMatch) {
    return undefined;
  }

  return (mentionMatch[1] ?? "").trim();
}

function readSupportedSlashCommand(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const commandMatch = value.match(/^\/([a-z0-9-]+)\b/i);
  if (!commandMatch) {
    return undefined;
  }

  const commandName = commandMatch[1].toLowerCase();
  return SUPPORTED_COMMANDS.has(commandName) ? commandName : undefined;
}

function getReactionEndpoint(
  repoFullName: string,
  subjectId: number,
  kind: GitHubReactionListTarget["kind"]
): string {
  const [owner, repo] = splitRepoFullName(repoFullName);

  return kind === "issue"
    ? `https://api.github.com/repos/${owner}/${repo}/issues/${subjectId}/reactions`
    : kind === "issue_comment"
      ? `https://api.github.com/repos/${owner}/${repo}/issues/comments/${subjectId}/reactions`
      : `https://api.github.com/repos/${owner}/${repo}/pulls/comments/${subjectId}/reactions`;
}

function mapGraphqlReaction(reaction: "eyes" | "rocket"): "EYES" | "ROCKET" {
  return reaction === "eyes" ? "EYES" : "ROCKET";
}

function splitRepoFullName(repoFullName: string): [string, string] {
  const [owner, repo] = repoFullName.split("/");

  if (!owner || !repo) {
    throw new Error(`Invalid repository name '${repoFullName}'.`);
  }

  return [owner, repo];
}

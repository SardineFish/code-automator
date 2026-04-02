import type { IncomingMessage, ServerResponse } from "node:http";
import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

import { RequestBodyError, readRequestBody } from "../../runtime/http/read-request-body.js";
import type { WebhookGateContext } from "../../types/runtime.js";
import type { GitHubReview } from "../../types/workflow-input.js";

const SUPPORTED_COMMANDS = new Set(["plan", "approve", "go", "implement", "code"]);
const installationTokenProviders = new Map<string, InstallationTokenProvider>();

export interface IssueMentionParseResult {
  hasMention: boolean;
  command?: string;
  content: string;
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
  if (!SUPPORTED_COMMANDS.has(commandName)) {
    return { hasMention: true, content: remainder };
  }

  return {
    hasMention: true,
    content: remainder,
    command: commandName
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

export interface InstallationTokenProvider {
  createInstallationToken(clientId: string, installationId: number): Promise<string>;
}

export function createInstallationTokenProvider(
  privateKeyPath: string,
  client: GitHubInstallationTokenClient
): InstallationTokenProvider {
  let privateKeyPromise: Promise<string> | undefined;

  return {
    async createInstallationToken(clientId, installationId) {
      const privateKey = await loadPrivateKey(privateKeyPath, privateKeyPromise);
      privateKeyPromise ??= Promise.resolve(privateKey);
      const jwt = generateGitHubAppJwt(clientId, privateKey);
      const response = await client.createInstallationAccessToken(jwt, installationId);
      return response.token;
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

async function loadPrivateKey(
  privateKeyPath: string,
  cachedPromise: Promise<string> | undefined
): Promise<string> {
  if (cachedPromise) {
    return cachedPromise;
  }

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
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${jwt}`,
          "User-Agent": "github-agent-orchestrator",
          "X-GitHub-Api-Version": "2022-11-28"
        }
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

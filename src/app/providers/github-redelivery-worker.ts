import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { getWhitelistRejectionReason } from "../../service/orchestration/check-whitelist.js";
import type { TrackingConfig } from "../../types/config.js";
import type { LogSink } from "../../types/logging.js";
import type { WebhookGateContext } from "../../types/runtime.js";
import type {
  GitHubAppWebhookDelivery,
  GitHubAppWebhookDeliveryClient
} from "./github-redelivery-client.js";
import { fetchGitHubAppWebhookDeliveryClient } from "./github-redelivery-client.js";
import type { ResolvedGitHubProviderConfig } from "./github-config.js";
import {
  getGitHubAppJwtProvider,
  getInstallationTokenProvider,
  listCommentReactions,
  parseIssueMention,
  readGate,
  readGitHubThreadState,
  readId,
  readInteger,
  readObject,
  readString,
  requireEnv,
  type GitHubReaction
} from "./github-utils.js";

const DELIVERY_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;
const DELIVERY_SETTLE_DELAY_MS = 60 * 1000;
const CHECKPOINT_OVERLAP_MS = 60 * 1000;

interface GitHubRedeliveryState {
  version: 1;
  checkpoint?: string;
  settledGuids: Record<string, string>;
}

interface GitHubReactionTarget {
  kind: "issue" | "issue_comment" | "pull_request_review_comment";
  subjectId: number;
}

interface GitHubRelevantDelivery {
  gate: WebhookGateContext;
  reactionTarget?: GitHubReactionTarget;
  threadTarget?: GitHubThreadTarget;
}

interface GitHubThreadTarget {
  kind: "issue" | "pull_request";
  number: number;
}

type GitHubDeliveryEvaluation =
  | { gate?: WebhookGateContext; reason: string; status: "ignored" }
  | { delivery: GitHubRelevantDelivery; status: "relevant" };

export interface GitHubRedeliveryWorker {
  start(): void;
  runOnce(): Promise<void>;
  stop(): Promise<void>;
}

export interface GitHubRedeliveryWorkerOptions {
  client?: GitHubAppWebhookDeliveryClient;
  env: NodeJS.ProcessEnv;
  github: ResolvedGitHubProviderConfig;
  logSink: LogSink;
  now?: () => Date;
  tracking: TrackingConfig;
}

export function createGitHubRedeliveryWorker(options: GitHubRedeliveryWorkerOptions): GitHubRedeliveryWorker {
  const redelivery = options.github.redelivery;

  if (!redelivery) {
    return {
      start() {},
      async runOnce() {},
      async stop() {}
    };
  }

  const redeliveryConfig = redelivery;
  const now = options.now ?? (() => new Date());
  const privateKeyPath = requireEnv(options.env, "GITHUB_APP_PRIVATE_KEY_PATH");
  const client = options.client ?? fetchGitHubAppWebhookDeliveryClient;
  const jwtProvider = getGitHubAppJwtProvider(privateKeyPath);
  const installationTokenProvider = getInstallationTokenProvider(privateKeyPath);
  const stateFilePath = getGitHubRedeliveryStateFilePath(options.tracking.stateFile);
  const log = options.logSink.child({ source: "gh-redelivery" });
  let started = false;
  let inFlight: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  return {
    start() {
      if (started || stopped) {
        return;
      }

      started = true;
      timer = setInterval(() => {
        if (stopped) {
          return;
        }

        void this.runOnce().catch((error) => logWorkerError(log, error));
      }, redeliveryConfig.intervalSeconds * 1000);

      timer.unref();
    },
    runOnce() {
      if (inFlight) {
        return inFlight;
      }

      inFlight = runWorker().finally(() => {
        inFlight = undefined;
      });

      return inFlight;
    },
    async stop() {
      stopped = true;

      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }

      await inFlight;
    }
  };

  async function runWorker(): Promise<void> {
    const scanStartedAt = now();
    const scanStartedAtIso = scanStartedAt.toISOString();
    const state = pruneGitHubRedeliveryState(await loadState(stateFilePath), scanStartedAt);
    const jwt = await jwtProvider.createAppJwt(options.github.clientId);
    const scanStartMs = getScanStartMs(state.checkpoint, scanStartedAt);
    const { deliveries, pageCount } = await listDeliveriesSince(client, jwt, scanStartMs);
    const candidates = selectGitHubRedeliveryCandidates(
      deliveries,
      state.settledGuids,
      scanStartedAt,
      redeliveryConfig.maxPerRun
    );
    const installationTokens = new Map<number, Promise<string>>();
    let retried = 0;
    let skippedAlreadyHandled = 0;
    let skippedByProviderFilter = 0;

    log.info({
      message: "scanned GitHub App webhook deliveries",
      pageCount,
      deliveryCount: deliveries.length,
      candidateCount: candidates.length,
      checkpoint: state.checkpoint ?? null
    });

    for (const candidate of candidates) {
      try {
        const detail = await client.getDelivery(jwt, candidate.id);
        const evaluation = evaluateRedeliveryDelivery(detail.eventName, detail.payload, options.github);

        if (evaluation.status === "ignored") {
          skippedByProviderFilter += 1;
          settleGuid(state, candidate.guid, scanStartedAtIso);
          await saveState(stateFilePath, state);
          log.info({
            message: "skipped GitHub App webhook delivery by provider filter",
            deliveryId: candidate.id,
            guid: candidate.guid,
            reason: evaluation.reason
          });
          continue;
        }

        const token = await getInstallationToken(evaluation.delivery.gate.installationId);
        const threadState = evaluation.delivery.threadTarget
          ? await readGitHubThreadState({
              repoFullName: evaluation.delivery.gate.repoFullName,
              subjectId: evaluation.delivery.threadTarget.number,
              token,
              kind: evaluation.delivery.threadTarget.kind
            })
          : undefined;

        if (threadState === "closed") {
          skippedByProviderFilter += 1;
          settleGuid(state, candidate.guid, scanStartedAtIso);
          log.info({
            message: "skipped GitHub App webhook delivery by provider filter",
            deliveryId: candidate.id,
            guid: candidate.guid,
            reason: evaluation.delivery.threadTarget?.kind === "pull_request" ? "pull_request_closed" : "issue_closed"
          });
          await saveState(stateFilePath, state);
          continue;
        }

        if (
          await isAlreadyHandledDelivery(
            evaluation.delivery.gate.repoFullName,
            evaluation.delivery.reactionTarget,
            token,
            options.github.botHandle
          )
        ) {
          skippedAlreadyHandled += 1;
          settleGuid(state, candidate.guid, scanStartedAtIso);
          await saveState(stateFilePath, state);
          log.info({
            message: "skipped GitHub App webhook delivery because already handled",
            deliveryId: candidate.id,
            guid: candidate.guid,
            reason: "bot_eyes_reaction"
          });
          continue;
        }

        await client.redeliverDelivery(jwt, candidate.id);
        retried += 1;
        settleGuid(state, candidate.guid, scanStartedAtIso);
        await saveState(stateFilePath, state);
        log.info({
          message: "retried GitHub App webhook delivery",
          deliveryId: candidate.id,
          guid: candidate.guid,
          reason: "relevant_unhandled_delivery",
          status: candidate.status,
          redelivery: candidate.redelivery
        });
      } catch (error) {
        log.warn({
          message: "GitHub App webhook redelivery candidate handling failed",
          deliveryId: candidate.id,
          guid: candidate.guid,
          errorMessage: error instanceof Error ? error.message : "Unknown redelivery candidate error."
        });
      }
    }

    state.checkpoint = scanStartedAtIso;
    await saveState(stateFilePath, pruneGitHubRedeliveryState(state, scanStartedAt));
    log.info({
      message: "completed GitHub App webhook delivery scan",
      deliveryCount: deliveries.length,
      candidateCount: candidates.length,
      retried,
      skippedAlreadyHandled,
      skippedByProviderFilter
    });

    function getInstallationToken(installationId: number): Promise<string> {
      const existing = installationTokens.get(installationId);

      if (existing) {
        return existing;
      }

      const created = installationTokenProvider.createInstallationToken(options.github.clientId, installationId);
      installationTokens.set(installationId, created);
      return created;
    }
  }
}

export function selectGitHubRedeliveryCandidates(
  deliveries: GitHubAppWebhookDelivery[],
  settledGuids: Record<string, string>,
  now: Date,
  maxPerRun: number
): GitHubAppWebhookDelivery[] {
  const groups = new Map<string, GitHubAppWebhookDelivery[]>();

  for (const delivery of deliveries) {
    const group = groups.get(delivery.guid);

    if (group) {
      group.push(delivery);
      continue;
    }

    groups.set(delivery.guid, [delivery]);
  }

  const candidates: GitHubAppWebhookDelivery[] = [];

  for (const [guid, group] of groups) {
    if (settledGuids[guid]) {
      continue;
    }

    group.sort((left, right) => Date.parse(right.deliveredAt) - Date.parse(left.deliveredAt));

    if (group.some((delivery) => isSuccessfulDelivery(delivery))) {
      continue;
    }

    const latest = group[0];

    if (!latest || !isFailedDelivery(latest) || now.getTime() - Date.parse(latest.deliveredAt) < DELIVERY_SETTLE_DELAY_MS) {
      continue;
    }

    candidates.push(latest);
  }

  candidates.sort((left, right) => Date.parse(left.deliveredAt) - Date.parse(right.deliveredAt));
  return candidates.slice(0, maxPerRun);
}

export function getGitHubRedeliveryStateFilePath(stateFile: string): string {
  const parsed = path.parse(stateFile);
  return path.join(parsed.dir, `${parsed.name}.runs`, "github-redelivery-state.json");
}

async function isAlreadyHandledDelivery(
  repoFullName: string,
  reactionTarget: GitHubReactionTarget | undefined,
  token: string,
  botHandle: string
): Promise<boolean> {
  if (!reactionTarget) {
    return false;
  }

  const reactions = await listCommentReactions({
    repoFullName,
    subjectId: reactionTarget.subjectId,
    token,
    kind: reactionTarget.kind
  });

  return hasBotEyesReaction(reactions, botHandle);
}

function hasBotEyesReaction(reactions: GitHubReaction[], botHandle: string): boolean {
  return reactions.some((reaction) => reaction.content === "eyes" && isBotReactionUser(reaction.userLogin, botHandle));
}

function isBotReactionUser(login: string | undefined, botHandle: string): boolean {
  if (!login) {
    return false;
  }

  const normalizedLogin = login.toLowerCase();
  const normalizedHandle = botHandle.toLowerCase();

  return normalizedLogin === normalizedHandle || normalizedLogin === `${normalizedHandle}[bot]`;
}

async function listDeliveriesSince(
  client: GitHubAppWebhookDeliveryClient,
  jwt: string,
  scanStartMs: number
): Promise<{ deliveries: GitHubAppWebhookDelivery[]; pageCount: number }> {
  const deliveries: GitHubAppWebhookDelivery[] = [];
  let pageCount = 0;
  let nextPageUrl: string | undefined;

  while (true) {
    pageCount += 1;
    const page = await client.listDeliveries(jwt, nextPageUrl);

    deliveries.push(...page.deliveries.filter((delivery) => Date.parse(delivery.deliveredAt) >= scanStartMs));

    if (!page.nextPageUrl || page.deliveries.length === 0) {
      break;
    }

    const oldestDeliveredAtMs = Math.min(...page.deliveries.map((delivery) => Date.parse(delivery.deliveredAt)));

    if (oldestDeliveredAtMs < scanStartMs) {
      break;
    }

    nextPageUrl = page.nextPageUrl;
  }

  return { deliveries, pageCount };
}

function getScanStartMs(checkpoint: string | undefined, now: Date): number {
  const earliestAllowedMs = now.getTime() - DELIVERY_LOOKBACK_MS;

  if (!checkpoint) {
    return earliestAllowedMs;
  }

  const checkpointMs = Date.parse(checkpoint);

  if (Number.isNaN(checkpointMs)) {
    return earliestAllowedMs;
  }

  return Math.max(earliestAllowedMs, checkpointMs - CHECKPOINT_OVERLAP_MS);
}

async function loadState(filePath: string): Promise<GitHubRedeliveryState> {
  try {
    const contents = await readFile(filePath, "utf8");
    return normalizeState(JSON.parse(contents) as unknown);
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return createEmptyState();
    }

    throw error;
  }
}

async function saveState(filePath: string, state: GitHubRedeliveryState): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.tmp`;

  await writeFile(tempFile, JSON.stringify(state, null, 2));
  await rename(tempFile, filePath);
}

function normalizeState(value: unknown): GitHubRedeliveryState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return createEmptyState();
  }

  const parsed = value as {
    checkpoint?: unknown;
    retriedGuids?: unknown;
    settledGuids?: unknown;
  };
  const settledGuids = normalizeSettledGuids(parsed.settledGuids);

  for (const [guid, settledAt] of Object.entries(normalizeSettledGuids(parsed.retriedGuids))) {
    settledGuids[guid] ??= settledAt;
  }

  return {
    version: 1,
    checkpoint: typeof parsed.checkpoint === "string" && parsed.checkpoint.trim() !== "" ? parsed.checkpoint : undefined,
    settledGuids
  };
}

function normalizeSettledGuids(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string> = {};

  for (const [guid, settledAt] of Object.entries(value)) {
    if (typeof settledAt === "string" && settledAt.trim() !== "") {
      result[guid] = settledAt;
      continue;
    }

    if (
      typeof settledAt === "object" &&
      settledAt !== null &&
      !Array.isArray(settledAt) &&
      typeof (settledAt as { settledAt?: unknown }).settledAt === "string" &&
      (settledAt as { settledAt: string }).settledAt.trim() !== ""
    ) {
      result[guid] = (settledAt as { settledAt: string }).settledAt;
    }
  }

  return result;
}

function pruneGitHubRedeliveryState(state: GitHubRedeliveryState, now: Date): GitHubRedeliveryState {
  const cutoffMs = now.getTime() - DELIVERY_LOOKBACK_MS;
  const settledGuids: Record<string, string> = {};

  for (const [guid, settledAt] of Object.entries(state.settledGuids)) {
    if (!Number.isNaN(Date.parse(settledAt)) && Date.parse(settledAt) >= cutoffMs) {
      settledGuids[guid] = settledAt;
    }
  }

  return {
    version: 1,
    checkpoint: state.checkpoint,
    settledGuids
  };
}

function createEmptyState(): GitHubRedeliveryState {
  return {
    version: 1,
    settledGuids: {}
  };
}

function evaluateRedeliveryDelivery(
  eventName: string,
  payload: Record<string, unknown>,
  github: ResolvedGitHubProviderConfig
): GitHubDeliveryEvaluation {
  const gate = readGate(payload);

  if (!gate) {
    return { status: "ignored", reason: "missing_gate_context" };
  }

  const rejectionReason = getWhitelistRejectionReason(github.whitelist, gate);
  if (rejectionReason) {
    return { status: "ignored", gate, reason: rejectionReason };
  }

  const action = readString(payload, "action");
  const issue = readObject(payload, "issue");
  const comment = readObject(payload, "comment");
  const review = readObject(payload, "review");
  const pullRequest = readObject(payload, "pull_request");

  if (eventName === "issues" && action === "opened") {
    const subjectNumber = readInteger(issue ?? {}, "number");

    if (!readId(issue) || subjectNumber === undefined) {
      return { status: "ignored", gate, reason: "invalid_delivery" };
    }

    return {
      status: "relevant",
      delivery: {
        gate,
        reactionTarget: { subjectId: subjectNumber, kind: "issue" },
        threadTarget: { number: subjectNumber, kind: "issue" }
      }
    };
  }

  if (eventName === "issue_comment" && action === "created") {
    const issueId = readId(issue);
    const subjectNumber = readInteger(issue ?? {}, "number");

    if (!issueId || subjectNumber === undefined || !comment) {
      return { status: "ignored", gate, reason: "invalid_delivery" };
    }

    const commentId = readInteger(comment, "id");

    if (readObject(issue ?? {}, "pull_request")) {
      return {
        status: "relevant",
        delivery: {
          gate,
          reactionTarget: readReactionTarget(commentId, "issue_comment"),
          threadTarget: { number: subjectNumber, kind: "pull_request" }
        }
      };
    }

    const content = readString(comment, "body") ?? "";
    const mention = parseIssueMention(content, github.botHandle, github.requireMention);

    if (!mention.hasMention && github.requireMention) {
      return { status: "ignored", gate, reason: "not_mentioned" };
    }

    return {
      status: "relevant",
      delivery: {
        gate,
        reactionTarget: readReactionTarget(commentId, "issue_comment"),
        threadTarget: { number: subjectNumber, kind: "issue" }
      }
    };
  }

  if (eventName === "pull_request_review_comment" && action === "created") {
    const prId = readId(pullRequest);
    const subjectNumber = readInteger(pullRequest ?? {}, "number");

    if (!prId || subjectNumber === undefined || !comment) {
      return { status: "ignored", gate, reason: "invalid_delivery" };
    }

    return {
      status: "relevant",
      delivery: {
        gate,
        reactionTarget: readReactionTarget(readInteger(comment, "id"), "pull_request_review_comment"),
        threadTarget: { number: subjectNumber, kind: "pull_request" }
      }
    };
  }

  if (eventName === "pull_request_review") {
    const prId = readId(pullRequest);
    const subjectNumber = readInteger(pullRequest ?? {}, "number");

    if (!prId || subjectNumber === undefined || !review) {
      return { status: "ignored", gate, reason: "invalid_delivery" };
    }

    return {
      status: "relevant",
      delivery: {
        gate,
        threadTarget: { number: subjectNumber, kind: "pull_request" }
      }
    };
  }

  return { status: "ignored", gate, reason: "unsupported_event" };
}

function readReactionTarget(
  subjectId: number | undefined,
  kind: GitHubReactionTarget["kind"]
): GitHubReactionTarget | undefined {
  return subjectId === undefined ? undefined : { subjectId, kind };
}

function isSuccessfulDelivery(delivery: GitHubAppWebhookDelivery): boolean {
  const status = delivery.status.trim().toUpperCase();

  return status === "OK" || (delivery.statusCode !== undefined && delivery.statusCode >= 200 && delivery.statusCode < 300);
}

function isFailedDelivery(delivery: GitHubAppWebhookDelivery): boolean {
  const status = delivery.status.trim().toUpperCase();

  if (isSuccessfulDelivery(delivery)) {
    return false;
  }

  return status !== "PENDING" && status !== "IN_PROGRESS";
}

function isErrnoException(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === code;
}

function logWorkerError(log: LogSink, error: unknown): void {
  log.error({
    message: "GitHub App webhook delivery scan failed",
    errorMessage: error instanceof Error ? error.message : "Unknown redelivery worker error."
  });
}

function settleGuid(state: GitHubRedeliveryState, guid: string, settledAt: string): void {
  state.settledGuids[guid] = settledAt;
}

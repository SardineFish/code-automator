import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TrackingConfig } from "../../types/config.js";
import type { LogSink } from "../../types/logging.js";
import { fetchGitHubAppWebhookDeliveryClient, type GitHubAppWebhookDelivery, type GitHubAppWebhookDeliveryClient } from "./github-redelivery-client.js";
import type { ResolvedGitHubProviderConfig } from "./github-config.js";
import { getGitHubAppJwtProvider, requireEnv } from "./github-utils.js";

const DELIVERY_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;
const DELIVERY_SETTLE_DELAY_MS = 60 * 1000;
const CHECKPOINT_OVERLAP_MS = 60 * 1000;

interface GitHubRedeliveryState {
  version: 1;
  checkpoint?: string;
  retriedGuids: Record<string, string>;
}

export interface GitHubRedeliveryWorker {
  start(): void;
  runOnce(): Promise<void>;
}

export interface GitHubRedeliveryWorkerOptions {
  github: ResolvedGitHubProviderConfig;
  tracking: TrackingConfig;
  env: NodeJS.ProcessEnv;
  logSink: LogSink;
  client?: GitHubAppWebhookDeliveryClient;
  now?: () => Date;
}

export function createGitHubRedeliveryWorker(options: GitHubRedeliveryWorkerOptions): GitHubRedeliveryWorker {
  const redelivery = options.github.redelivery;

  if (!redelivery) {
    return {
      start() {},
      async runOnce() {}
    };
  }
  const redeliveryConfig = redelivery;

  const now = options.now ?? (() => new Date());
  const privateKeyPath = requireEnv(options.env, "GITHUB_APP_PRIVATE_KEY_PATH");
  const client = options.client ?? fetchGitHubAppWebhookDeliveryClient;
  const jwtProvider = getGitHubAppJwtProvider(privateKeyPath);
  const stateFilePath = getGitHubRedeliveryStateFilePath(options.tracking.stateFile);
  const log = options.logSink.child({ source: "gh-redelivery" });
  let started = false;
  let inFlight: Promise<void> | undefined;

  return {
    start() {
      if (started) {
        return;
      }

      started = true;
      void this.runOnce().catch((error) => logWorkerError(log, error));

      const timer = setInterval(() => {
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
      state.retriedGuids,
      scanStartedAt,
      redeliveryConfig.maxPerRun
    );
    let attempted = 0;

    log.info({
      message: "scanned GitHub App webhook deliveries",
      pageCount,
      deliveryCount: deliveries.length,
      candidateCount: candidates.length,
      checkpoint: state.checkpoint ?? null
    });

    for (const candidate of candidates) {
      try {
        await client.redeliverDelivery(jwt, candidate.id);
        state.retriedGuids[candidate.guid] = scanStartedAtIso;
        attempted += 1;
        await saveState(stateFilePath, state);
        log.info({
          message: "requested GitHub App webhook redelivery",
          deliveryId: candidate.id,
          guid: candidate.guid,
          status: candidate.status,
          redelivery: candidate.redelivery
        });
      } catch (error) {
        log.warn({
          message: "GitHub App webhook redelivery request failed",
          deliveryId: candidate.id,
          guid: candidate.guid,
          errorMessage: error instanceof Error ? error.message : "Unknown redelivery error."
        });
      }
    }

    state.checkpoint = scanStartedAtIso;
    await saveState(stateFilePath, pruneGitHubRedeliveryState(state, scanStartedAt));
    log.info({
      message: "completed GitHub App webhook delivery scan",
      deliveryCount: deliveries.length,
      candidateCount: candidates.length,
      attempted
    });
  }
}

export function selectGitHubRedeliveryCandidates(
  deliveries: GitHubAppWebhookDelivery[],
  retriedGuids: Record<string, string>,
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
    if (retriedGuids[guid]) {
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
  };

  return {
    version: 1,
    checkpoint: typeof parsed.checkpoint === "string" && parsed.checkpoint.trim() !== "" ? parsed.checkpoint : undefined,
    retriedGuids: normalizeRetriedGuids(parsed.retriedGuids)
  };
}

function normalizeRetriedGuids(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string> = {};

  for (const [guid, attemptedAt] of Object.entries(value)) {
    if (typeof attemptedAt === "string" && attemptedAt.trim() !== "") {
      result[guid] = attemptedAt;
    }
  }

  return result;
}

function pruneGitHubRedeliveryState(state: GitHubRedeliveryState, now: Date): GitHubRedeliveryState {
  const cutoffMs = now.getTime() - DELIVERY_LOOKBACK_MS;
  const retriedGuids: Record<string, string> = {};

  for (const [guid, attemptedAt] of Object.entries(state.retriedGuids)) {
    if (!Number.isNaN(Date.parse(attemptedAt)) && Date.parse(attemptedAt) >= cutoffMs) {
      retriedGuids[guid] = attemptedAt;
    }
  }

  return {
    version: 1,
    checkpoint: state.checkpoint,
    retriedGuids
  };
}

function createEmptyState(): GitHubRedeliveryState {
  return {
    version: 1,
    retriedGuids: {}
  };
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
    message: "GitHub App webhook redelivery scan failed",
    errorMessage: error instanceof Error ? error.message : "Unknown redelivery worker error."
  });
}

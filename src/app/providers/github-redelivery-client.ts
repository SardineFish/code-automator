import {
  type GitHubDeliveryPayload,
  normalizeGitHubDeliveryPayload
} from "./github-delivery-relevance.js";
import { asObject, readInteger, readString } from "./github-utils.js";

export interface GitHubAppWebhookDelivery {
  action?: string;
  deliveredAt: string;
  eventName: string;
  guid: string;
  id: number;
  redelivery: boolean;
  status: string;
  statusCode?: number;
}

export interface GitHubAppWebhookDeliveryDetail extends GitHubAppWebhookDelivery {
  payload: GitHubDeliveryPayload;
}

export interface GitHubAppWebhookDeliveryPage {
  deliveries: GitHubAppWebhookDelivery[];
  nextPageUrl?: string;
}

export interface GitHubAppWebhookDeliveryClient {
  getDelivery(jwt: string, deliveryId: number): Promise<GitHubAppWebhookDeliveryDetail>;
  listDeliveries(jwt: string, pageUrl?: string): Promise<GitHubAppWebhookDeliveryPage>;
  redeliverDelivery(jwt: string, deliveryId: number): Promise<void>;
}

export const fetchGitHubAppWebhookDeliveryClient: GitHubAppWebhookDeliveryClient = {
  async getDelivery(jwt, deliveryId) {
    const response = await fetch(`https://api.github.com/app/hook/deliveries/${deliveryId}`, {
      headers: createGitHubAppHeaders(jwt)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub webhook delivery detail request failed: ${response.status} ${body}`);
    }

    const payload = normalizeDeliveryDetail((await response.json()) as unknown);

    if (!payload) {
      throw new Error("GitHub webhook delivery detail response was missing required fields.");
    }

    return payload;
  },
  async listDeliveries(jwt, pageUrl) {
    const response = await fetch(pageUrl ?? "https://api.github.com/app/hook/deliveries?per_page=100", {
      headers: createGitHubAppHeaders(jwt)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub webhook delivery list request failed: ${response.status} ${body}`);
    }

    const payload = (await response.json()) as unknown;

    if (!Array.isArray(payload)) {
      throw new Error("GitHub webhook delivery list response did not return an array.");
    }

    return {
      deliveries: payload.flatMap((entry) => {
        const normalized = normalizeDelivery(entry);
        return normalized ? [normalized] : [];
      }),
      nextPageUrl: readNextPageUrl(response.headers.get("link"))
    };
  },
  async redeliverDelivery(jwt, deliveryId) {
    const response = await fetch(`https://api.github.com/app/hook/deliveries/${deliveryId}/attempts`, {
      method: "POST",
      headers: createGitHubAppHeaders(jwt)
    });

    if (response.ok) {
      return;
    }

    const body = await response.text();
    throw new Error(`GitHub webhook redelivery request failed: ${response.status} ${body}`);
  }
};

function normalizeDelivery(value: unknown): GitHubAppWebhookDelivery | null {
  const delivery = asObject(value);

  if (!delivery) {
    return null;
  }

  const summary = normalizeDeliverySummary(delivery);
  return summary ? { ...summary, eventName: readString(delivery, "event") ?? "" } : null;
}

function normalizeDeliveryDetail(value: unknown): GitHubAppWebhookDeliveryDetail | null {
  const delivery = asObject(value);
  const summary = delivery ? normalizeDeliverySummary(delivery) : null;
  const request = delivery ? asObject(delivery.request) : null;
  const payload = request ? asObject(request.payload) : null;
  const eventName = delivery ? readString(delivery, "event") : undefined;

  if (!summary || !payload || !eventName) {
    return null;
  }

  return {
    ...summary,
    eventName,
    payload: normalizeGitHubDeliveryPayload(payload)
  };
}

function normalizeDeliverySummary(value: Record<string, unknown>) {
  const id = readInteger(value, "id");
  const guid = readString(value, "guid");
  const deliveredAt = readString(value, "delivered_at");

  if (id === undefined || !guid || !deliveredAt || Number.isNaN(Date.parse(deliveredAt))) {
    return null;
  }

  return {
    id,
    guid,
    deliveredAt,
    action: readString(value, "action"),
    redelivery: typeof value.redelivery === "boolean" ? value.redelivery : false,
    status: readString(value, "status") ?? "",
    statusCode: readInteger(value, "status_code")
  };
}

function createGitHubAppHeaders(jwt: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${jwt}`,
    "User-Agent": "github-agent-orchestrator",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

function readNextPageUrl(linkHeader: string | null): string | undefined {
  if (!linkHeader) {
    return undefined;
  }

  for (const entry of linkHeader.split(",")) {
    const [target, relation] = entry.split(";").map((part) => part.trim());

    if (relation !== 'rel="next"' || !target?.startsWith("<") || !target.endsWith(">")) {
      continue;
    }

    return target.slice(1, -1);
  }

  return undefined;
}

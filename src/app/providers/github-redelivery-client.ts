import { fetchHelper } from "../../providers/http/fetch-helper.js";
import { asObject, readInteger, readString } from "./github-utils.js";
import { parseGitHubDeliveryJson } from "./github-redelivery-json.js";

export interface GitHubAppWebhookDelivery {
  id: string;
  guid: string;
  deliveredAt: string;
  redelivery: boolean;
  status: string;
  statusCode?: number;
}

export interface GitHubAppWebhookDeliveryDetail extends GitHubAppWebhookDelivery {
  eventName: string;
  payload: Record<string, unknown>;
}

export interface GitHubAppWebhookDeliveryPage {
  deliveries: GitHubAppWebhookDelivery[];
  nextPageUrl?: string;
}

export interface GitHubAppWebhookDeliveryClient {
  getDelivery(jwt: string, deliveryId: string): Promise<GitHubAppWebhookDeliveryDetail>;
  listDeliveries(jwt: string, pageUrl?: string): Promise<GitHubAppWebhookDeliveryPage>;
  redeliverDelivery(jwt: string, deliveryId: string): Promise<void>;
}

export const fetchGitHubAppWebhookDeliveryClient: GitHubAppWebhookDeliveryClient = {
  async getDelivery(jwt, deliveryId) {
    const response = await fetchHelper(`https://api.github.com/app/hook/deliveries/${deliveryId}`, {
      headers: createGitHubAppHeaders(jwt)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub webhook delivery detail request failed: ${response.status} ${body}`);
    }
    const payload = normalizeDeliveryDetail(parseGitHubDeliveryJson(await response.text()));
    if (!payload) {
      throw new Error("GitHub webhook delivery detail response was missing required fields.");
    }
    return payload;
  },
  async listDeliveries(jwt, pageUrl) {
    const response = await fetchHelper(pageUrl ?? "https://api.github.com/app/hook/deliveries?per_page=100", {
      headers: createGitHubAppHeaders(jwt)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub webhook delivery list request failed: ${response.status} ${body}`);
    }
    const payload = parseGitHubDeliveryJson(await response.text());
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
    const response = await fetchHelper(`https://api.github.com/app/hook/deliveries/${deliveryId}/attempts`, {
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
  const id = readString(delivery, "id");
  const guid = readString(delivery, "guid");
  const deliveredAt = readString(delivery, "delivered_at");

  if (id === undefined || !guid || !deliveredAt || Number.isNaN(Date.parse(deliveredAt))) {
    return null;
  }

  return {
    id,
    guid,
    deliveredAt,
    redelivery: typeof delivery.redelivery === "boolean" ? delivery.redelivery : false,
    status: readString(delivery, "status") ?? "",
    statusCode: readInteger(delivery, "status_code")
  };
}

function normalizeDeliveryDetail(value: unknown): GitHubAppWebhookDeliveryDetail | null {
  const delivery = asObject(value);
  const summary = delivery ? normalizeDelivery(delivery) : null;
  const request = delivery ? asObject(delivery.request) : null;
  const payload = request ? asObject(request.payload) : null;
  const eventName = delivery ? readString(delivery, "event") : undefined;

  if (!summary || !payload || !eventName) {
    return null;
  }

  return {
    ...summary,
    eventName,
    payload
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

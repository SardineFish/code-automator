import type { Server } from "node:http";

import type { ServiceConfig } from "../types/config.js";
import { App } from "./app.js";
import { resolveGitHubProviderConfig } from "./providers/github-config.js";
import { githubProvider } from "./providers/github-provider.js";

export function startService(config: ServiceConfig): Promise<Server> {
  const github = resolveGitHubProviderConfig(config.gh);

  return App({ ...config, gh: github })
    .provider(github.url, githubProvider)
    .listen();
}

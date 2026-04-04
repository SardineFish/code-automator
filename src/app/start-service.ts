import type { ServiceConfig } from "../types/config.js";
import { App, type AppLifecycle } from "./app.js";
import { resolveGitHubProviderConfig } from "./providers/github-config.js";
import { githubRedeliveryService } from "./providers/github-redelivery-service.js";
import { githubProvider } from "./providers/github-provider.js";

export function startService(config: ServiceConfig): Promise<AppLifecycle> {
  const github = resolveGitHubProviderConfig(config.gh);

  return App({ ...config, gh: github })
    .provider(github.url, githubProvider)
    .service(githubRedeliveryService)
    .listen();
}

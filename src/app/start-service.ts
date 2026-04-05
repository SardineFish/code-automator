import type { ServiceConfig } from "../types/config.js";
import { App, type AppLifecycle } from "./app.js";
import { createAppRuntimeOptions, resolveBaseEnv } from "./default-app-runtime.js";
import { resolveGitHubProviderConfig } from "./providers/github-config.js";
import { githubRedeliveryService } from "./providers/github-redelivery-service.js";
import { githubProvider } from "./providers/github-provider.js";

export async function startService(config: ServiceConfig): Promise<AppLifecycle> {
  const github = resolveGitHubProviderConfig(config.gh);
  const baseEnv = resolveBaseEnv(undefined);
  const runtimeConfig = { ...config, gh: github };
  const runtimeOptions = createAppRuntimeOptions(runtimeConfig, { baseEnv });
  const builder = App(runtimeConfig, runtimeOptions)
    .provider(github.url, githubProvider)
    .service(githubRedeliveryService);

  for (const extension of runtimeConfig.extensions) {
    builder.extension(extension.id, extension.use, extension.config);
  }

  return builder.listen();
}

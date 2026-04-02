import { pathToFileURL } from "node:url";

import { loadServiceConfig } from "../config/load-service-config.js";
import { App } from "./app.js";
import { githubProvider } from "./providers/github-provider.js";
import { resolveConfigPath } from "./resolve-config-path.js";

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const configPath = resolveConfigPath(argv);
  const config = await loadServiceConfig(configPath);
  const github = config.gh;

  if (!github) {
    throw new Error("Missing gh provider config.");
  }

  await App(config)
    .provider(github.url, githubProvider)
    .listen();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Unknown startup error."}\n`);
    process.exitCode = 1;
  });
}

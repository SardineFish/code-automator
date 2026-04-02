import type { Server } from "node:http";

import type { ServiceConfig } from "../types/config.js";
import { App } from "./app.js";
import { githubProvider } from "./providers/github-provider.js";

export function startService(config: ServiceConfig): Promise<Server> {
  const github = config.gh;

  if (!github) {
    throw new Error("Missing gh provider config.");
  }

  return App(config)
    .provider(github.url, githubProvider)
    .listen();
}

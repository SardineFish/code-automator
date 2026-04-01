import { pathToFileURL } from "node:url";

import { resolveConfigPath } from "./resolve-config-path.js";
import { startService } from "./start-service.js";

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const configPath = resolveConfigPath(argv);
  await startService(configPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Unknown startup error."}\n`);
    process.exitCode = 1;
  });
}

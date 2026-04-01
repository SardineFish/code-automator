export function resolveConfigPath(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): string {
  const configFlagIndex = argv.findIndex((value) => value === "--config");
  const configFlagValue = configFlagIndex >= 0 ? argv[configFlagIndex + 1] : undefined;
  const configPath = configFlagValue ?? env.GITHUB_AGENT_ORCHESTRATOR_CONFIG;

  if (!configPath) {
    throw new Error(
      "Missing config path. Pass --config <path> or set GITHUB_AGENT_ORCHESTRATOR_CONFIG."
    );
  }

  return configPath;
}

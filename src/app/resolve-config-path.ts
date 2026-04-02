export function resolveConfigPath(argv: string[] = process.argv.slice(2)): string {
  const configFlagIndex = argv.findIndex((value) => value === "--config");
  const configPath = configFlagIndex >= 0 ? argv[configFlagIndex + 1] : undefined;

  if (!configPath) {
    throw new Error("Missing config path. Pass --config <path>.");
  }

  return configPath;
}

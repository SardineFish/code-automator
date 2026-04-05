import type { AppExtensionDefinition, AppExtensionBuilder } from "../types/extensions.js";
import type { LogSink } from "../types/logging.js";
import { loadAppExtensionModule } from "./load-app-extension-module.js";

export async function loadConfiguredExtensions(
  builder: AppExtensionBuilder,
  extensions: AppExtensionDefinition[],
  configDir: string,
  env: NodeJS.ProcessEnv,
  logSink: LogSink
): Promise<void> {
  for (const extension of extensions) {
    const extensionLog = logSink.child({ source: "extension", extensionId: extension.id });
    const module = await loadAppExtensionModule(extension);

    try {
      await module.init(builder, {
        id: extension.id,
        config: extension.config,
        configDir,
        env,
        log: extensionLog
      });
    } catch (error) {
      throw new Error(
        `Failed to initialize extension '${extension.id}' from '${extension.use}': ${error instanceof Error ? error.message : "Unknown extension initialization error."}`
      );
    }

    extensionLog.info({
      message: "extension loaded",
      extensionPath: extension.use
    });
  }
}

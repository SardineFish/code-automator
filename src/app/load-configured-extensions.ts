import type { AppExtensionDefinition, AppExtensionBuilder } from "../types/extensions.js";
import type { LogSink } from "../types/logging.js";
import { createExtensionBuilder } from "./bind-extension-context.js";
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
    const extensionConfigRef = {
      current: extension.config
    };
    const extensionBuilder = createExtensionBuilder(builder, () => extensionConfigRef.current);
    const module = await loadAppExtensionModule(extension);

    try {
      await module.init(extensionBuilder, {
        id: extension.id,
        config: extensionConfigRef.current,
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

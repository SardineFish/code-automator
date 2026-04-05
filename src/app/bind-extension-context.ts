import type { AppExtensionBuilder } from "../types/extensions.js";
import type {
  AppContext,
  AppServiceHandler,
  ProviderHandler,
  WorkflowContext
} from "../types/runtime.js";

export function createExtensionBuilder<TConfig>(
  builder: AppExtensionBuilder,
  getExtensionConfig: () => TConfig
): AppExtensionBuilder<TConfig> {
  const extensionBuilder: AppExtensionBuilder<TConfig> = {
    provider<TArgs extends unknown[] = unknown[], TResult = unknown>(
      key: string,
      handler: ProviderHandler<TArgs, TResult, TConfig>
    ): AppExtensionBuilder<TConfig> {
      const boundHandler: ProviderHandler<TArgs, TResult> = async (workflow, ...args) =>
        handler(bindWorkflowContext(workflow, getExtensionConfig), ...args);

      builder.provider(key, boundHandler);
      return extensionBuilder;
    },
    service(handler: AppServiceHandler<TConfig>): AppExtensionBuilder<TConfig> {
      builder.service((app) => handler(bindAppContext(app, getExtensionConfig)));
      return extensionBuilder;
    }
  };

  return extensionBuilder;
}

export function bindAppContext<TConfig>(
  appContext: AppContext,
  getExtensionConfig: () => TConfig
): AppContext<TConfig> {
  const boundAppContext = {
    ...appContext,
    createWorkflow(source: string): WorkflowContext<TConfig> {
      return bindWorkflowContext(appContext.createWorkflow(source), getExtensionConfig);
    }
  } as AppContext<TConfig>;

  return defineExtensionConfig(boundAppContext, getExtensionConfig);
}

export function bindWorkflowContext<TConfig>(
  workflowContext: WorkflowContext,
  getExtensionConfig: () => TConfig
): WorkflowContext<TConfig> {
  return defineExtensionConfig(
    {
      ...workflowContext
    } as WorkflowContext<TConfig>,
    getExtensionConfig
  );
}

function defineExtensionConfig<TValue, TObject extends { extensionConfig: TValue }>(
  target: TObject,
  getValue: () => TValue
): TObject {
  Object.defineProperty(target, "extensionConfig", {
    configurable: true,
    enumerable: true,
    get: getValue
  });

  return target;
}

import type { IncomingMessage, ServerResponse } from "node:http";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { App } from "../../src/app/app.js";
import { loadConfiguredExtensions } from "../../src/app/load-configured-extensions.js";
import type { AppExtensionBuilder } from "../../src/types/extensions.js";
import { createMemoryLogSink, createNoOpLogSink, type CapturedLogRecord } from "../fixtures/log-sink.js";
import { createServiceConfig } from "../fixtures/service-config.js";

test("loadConfiguredExtensions loads local files and package directories in config order", async (t) => {
  const dir = createTempDir(t, "gao-extensions-");
  const fileExtensionPath = path.join(dir, "file-extension.js");
  const packageDir = path.join(dir, "package-extension");
  const packageEntryPath = path.join(packageDir, "index.cjs");
  const records: CapturedLogRecord[] = [];
  const providerKeys: string[] = [];
  const serviceHandlers: Array<() => Promise<void>> = [];
  const builder = createRecordingBuilder(providerKeys, serviceHandlers);
  const config = createServiceConfig();

  writeFileSync(
    fileExtensionPath,
    `export default {
  API_VERSION: 1,
  async init(builder, context) {
    context.log.info({
      message: "file extension init",
      configDir: context.configDir,
      envValue: context.env.TEST_EXTENSION_ENV,
      routePath: context.config.routePath
    });
    builder.provider(context.config.routePath, async () => undefined);
    builder.service(async () => undefined);
  }
};
`
  );
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(packageEntryPath, `module.exports = {
  API_VERSION: 1,
  async init(builder, context) {
    context.log.info({
      message: "package extension init",
      configDir: context.configDir,
      envValue: context.env.TEST_EXTENSION_ENV,
      routePath: context.config.routePath
    });
    builder.provider(context.config.routePath, async () => undefined);
    builder.service(async () => undefined);
  }
};
`);
  writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify({
      name: "example-package-extension",
      main: "./index.cjs"
    })
  );

  config.configDir = dir;
  config.extensions = [
    {
      id: "file-extension",
      use: fileExtensionPath,
      config: {
        routePath: "/file-hook"
      }
    },
    {
      id: "package-extension",
      use: packageDir,
      config: {
        routePath: "/package-hook"
      }
    }
  ];

  await loadConfiguredExtensions(
    builder,
    config.extensions,
    config.configDir,
    {
      TEST_EXTENSION_ENV: "present"
    },
    createMemoryLogSink(records)
  );

  assert.deepEqual(providerKeys, ["/file-hook", "/package-hook"]);
  assert.equal(serviceHandlers.length, 2);
  assert.deepEqual(
    records
      .filter((record) => record.message === "extension loaded")
      .map((record) => record.extensionId),
    ["file-extension", "package-extension"]
  );
  assert.deepEqual(
    records
      .filter((record) => record.message.endsWith("extension init"))
      .map((record) => ({
        extensionId: record.extensionId,
        configDir: record.configDir,
        envValue: record.envValue,
        routePath: record.routePath
      })),
    [
      {
        extensionId: "file-extension",
        configDir: dir,
        envValue: "present",
        routePath: "/file-hook"
      },
      {
        extensionId: "package-extension",
        configDir: dir,
        envValue: "present",
        routePath: "/package-hook"
      }
    ]
  );
});

test("loadConfiguredExtensions rejects missing extension modules", async (t) => {
  const dir = createTempDir(t, "gao-extensions-missing-");
  const config = createServiceConfig();

  config.configDir = dir;
  config.extensions = [
    {
      id: "missing-extension",
      use: path.join(dir, "missing.js")
    }
  ];

  await assert.rejects(
    () =>
      loadConfiguredExtensions(
        createRecordingBuilder([], []),
        config.extensions,
        config.configDir,
        {},
        createNoOpLogSink()
      ),
    /missing-extension'.*was not found/
  );
});

test("loadConfiguredExtensions rejects invalid extension export shapes", async (t) => {
  const dir = createTempDir(t, "gao-extensions-invalid-shape-");
  const invalidExtensionPath = path.join(dir, "invalid-shape.js");
  const config = createServiceConfig();

  writeFileSync(
    invalidExtensionPath,
    `export default {
  API_VERSION: 1
};
`
  );

  config.configDir = dir;
  config.extensions = [
    {
      id: "invalid-shape",
      use: invalidExtensionPath
    }
  ];

  await assert.rejects(
    () =>
      loadConfiguredExtensions(
        createRecordingBuilder([], []),
        config.extensions,
        config.configDir,
        {},
        createNoOpLogSink()
      ),
    /must export an init\(builder, context\) function/
  );
});

test("loadConfiguredExtensions rejects mismatched API versions", async (t) => {
  const dir = createTempDir(t, "gao-extensions-version-");
  const invalidExtensionPath = path.join(dir, "invalid-version.js");
  const config = createServiceConfig();

  writeFileSync(
    invalidExtensionPath,
    `export default {
  API_VERSION: 2,
  async init() {}
};
`
  );

  config.configDir = dir;
  config.extensions = [
    {
      id: "invalid-version",
      use: invalidExtensionPath
    }
  ];

  await assert.rejects(
    () =>
      loadConfiguredExtensions(
        createRecordingBuilder([], []),
        config.extensions,
        config.configDir,
        {},
        createNoOpLogSink()
      ),
    /requires 1/
  );
});

test("loadConfiguredExtensions preserves provider collision failures against existing registrations", async (t) => {
  const dir = createTempDir(t, "gao-extensions-collision-");
  const extensionPath = path.join(dir, "collision.js");
  const config = createAppConfig();
  const builder = App(config, createRuntimeOptions());

  writeFileSync(
    extensionPath,
    `export default {
  API_VERSION: 1,
  async init(builder, context) {
    builder.provider(context.config.routePath, async (_workflow, _request, response) => {
      response.statusCode = 204;
      response.end();
    });
  }
};
`
  );

  config.configDir = dir;
  config.extensions = [
    {
      id: "collision",
      use: extensionPath,
      config: {
        routePath: "/built-in"
      }
    }
  ];

  builder.provider<[IncomingMessage, ServerResponse], void>(
    "/built-in",
    async (_workflow, _request, response) => {
      response.statusCode = 204;
      response.end();
    }
  );

  await assert.rejects(
    () => loadConfiguredExtensions(builder, config.extensions, config.configDir, {}, createNoOpLogSink()),
    /already registered/
  );
});

function createRecordingBuilder(
  providerKeys: string[],
  serviceHandlers: Array<() => Promise<void>>
): AppExtensionBuilder {
  const builder: AppExtensionBuilder = {
    provider(key) {
      providerKeys.push(key);
      return builder;
    },
    service(handler) {
      serviceHandlers.push(handler as () => Promise<void>);
      return builder;
    }
  };

  return builder;
}

function createAppConfig() {
  return {
    ...createServiceConfig(),
    server: {
      host: "127.0.0.1",
      port: 0
    }
  };
}

function createRuntimeOptions() {
  return {
    processRunner: {
      async run() {
        throw new Error("should not run");
      },
      async startDetached() {
        throw new Error("should not run");
      },
      isProcessRunning() {
        return false;
      },
      async readDetachedResult() {
        return null;
      }
    },
    workspaceRepo: {
      async createRunWorkspace() {
        throw new Error("should not run");
      },
      async ensureReusableWorkspace() {
        throw new Error("should not run");
      },
      async removeWorkspace() {}
    },
    workflowTracker: {
      async initialize() {},
      async createQueuedRun() {
        throw new Error("should not run");
      },
      async getLaunchableQueuedRuns() {
        return [];
      },
      async getActiveRuns() {
        return [];
      },
      subscribeTerminalEvents() {
        return () => undefined;
      },
      async updateQueuedRun() {
        throw new Error("should not run");
      },
      async getActiveRunCount() {
        return 0;
      },
      async markRunning() {
        throw new Error("should not run");
      },
      async markTerminal() {
        throw new Error("should not run");
      },
      async reconcileActiveRuns() {
        return [];
      }
    },
    logSink: createNoOpLogSink(),
    reconcileIntervalMs: 0
  };
}

function createTempDir(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

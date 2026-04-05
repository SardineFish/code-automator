import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { startService } from "../../src/app/start-service.js";
import { createServiceConfig } from "../fixtures/service-config.js";

test("startService keeps built-in GitHub registration explicit and loads configured local extensions", async (t) => {
  const dir = createTempDir(t, "gao-start-service-");
  const extensionPath = path.join(dir, "example-extension.js");
  const config = createServiceConfig();

  writeFileSync(
    extensionPath,
    `export default {
  API_VERSION: 1,
  async init(builder, context) {
    builder.provider(context.config.routePath, async (_workflow, _request, response) => {
      response.statusCode = 200;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({
        extensionId: context.id,
        configDir: context.configDir
      }));
    });
  }
};
`
  );

  config.configDir = dir;
  config.server = {
    host: "127.0.0.1",
    port: 0
  };
  config.tracking = {
    stateFile: path.join(dir, "state.json"),
    logFile: path.join(dir, "runs.jsonl")
  };
  config.workspace = {
    enabled: false,
    baseDir: path.join(dir, "workspaces"),
    cleanupAfterRun: false
  };
  config.extensions = [
    {
      id: "example-extension",
      use: extensionPath,
      config: {
        routePath: "/custom-hook"
      }
    }
  ];

  const app = await startService(config);
  const address = app.server.address();

  if (!address || typeof address === "string") {
    throw new Error("Unexpected test server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const extensionResult = await fetch(`${baseUrl}/custom-hook`, { method: "POST" });
  const githubResult = await fetch(`${baseUrl}${config.gh?.url ?? "/gh-hook"}`, { method: "GET" });

  assert.equal(extensionResult.status, 200);
  assert.deepEqual(await extensionResult.json(), {
    extensionId: "example-extension",
    configDir: dir
  });
  assert.equal(githubResult.status, 405);

  await app.shutdown();
});

function createTempDir(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

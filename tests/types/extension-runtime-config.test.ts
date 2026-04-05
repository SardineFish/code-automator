import assert from "node:assert/strict";
import test from "node:test";

import type { AppExtensionBuilder } from "../../src/types/extensions.js";

const extensionBuilder = null as unknown as AppExtensionBuilder<{
  routePath: string;
  message?: string;
}>;

if (false) {
  extensionBuilder.provider("/chat", async (workflow) => {
    const routePath: string = workflow.extensionConfig.routePath;
    const configDir: string = workflow.config.configDir;

    void routePath;
    void configDir;
  });

  extensionBuilder.service(async (app) => {
    const routePath: string = app.extensionConfig.routePath;
    const workflowRoutePath: string = app.createWorkflow("/chat").extensionConfig.routePath;

    void routePath;
    void workflowRoutePath;
  });
}

test("extension runtime config typings compile", () => {
  assert.equal(typeof extensionBuilder, "object");
});

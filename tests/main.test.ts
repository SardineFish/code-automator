import assert from "node:assert/strict";
import test from "node:test";

import { resolveConfigPath } from "../src/app/resolve-config-path.js";

test("resolveConfigPath prefers the --config flag", () => {
  assert.equal(resolveConfigPath(["--config", "/tmp/service.yml"]), "/tmp/service.yml");
});

test("resolveConfigPath rejects missing config value after the flag", () => {
  assert.throws(() => resolveConfigPath(["--config"]), {
    message: /Missing config path\. Pass --config <path>\./
  });
});

test("resolveConfigPath rejects missing config input", () => {
  assert.throws(() => resolveConfigPath([]), {
    message: /Missing config path/
  });
});

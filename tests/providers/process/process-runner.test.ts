import assert from "node:assert/strict";
import test from "node:test";

import { shellProcessRunner } from "../../../src/providers/process/process-runner.js";

test("shellProcessRunner rejects spawn failures", async () => {
  await assert.rejects(
    () =>
      shellProcessRunner.run("echo hi", {
        env: process.env,
        cwd: "/path/that/does/not/exist"
      }),
    /ENOENT/
  );
});

test("shellProcessRunner escalates timed-out processes", async () => {
  const result = await shellProcessRunner.run("trap '' TERM; while :; do sleep 1; done", {
    env: process.env,
    cwd: process.cwd(),
    timeoutMs: 25
  });

  assert.equal(result.timedOut, true);
  assert.ok(result.signal === "SIGTERM" || result.signal === "SIGKILL");
});

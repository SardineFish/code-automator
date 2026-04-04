import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { CODEX_REUSE_STATE_FILE } from "../../scripts/codex-reuse.js";
import { resetSession } from "../../scripts/reset-session.js";

test("reset-session removes the reusable workspace and switches away from it first", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gao-reset-session-"));
  const workspacePath = path.join(root, "acme_demo#7");
  await mkdir(workspacePath, { recursive: true });
  await writeFile(path.join(root, "placeholder.txt"), "keep");
  await writeFile(path.join(workspacePath, CODEX_REUSE_STATE_FILE), JSON.stringify({ threadId: "thread-123" }));

  let changedDirectoryTo: string | undefined;
  const stderr = new PassThrough();
  await resetSession(workspacePath, {
    cwd: workspacePath,
    stderr,
    chdir(nextPath: string) {
      changedDirectoryTo = nextPath;
    }
  });

  await assert.rejects(() => access(workspacePath));
  assert.equal(changedDirectoryTo, root);
});

test("reset-session logs the cleanup steps", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gao-reset-session-log-"));
  const workspacePath = path.join(root, "acme_demo#8");
  const stderr = new PassThrough();
  let output = "";

  stderr.setEncoding("utf8");
  stderr.on("data", (chunk) => {
    output += chunk;
  });

  await mkdir(workspacePath, { recursive: true });

  await resetSession(workspacePath, {
    cwd: path.join(root, "outside"),
    stderr
  });

  assert.match(output, /reset-session: starting workspace=/);
  assert.match(output, /reset-session: metadata cleanup skipped path=/);
  assert.match(output, /reset-session: cwd already outside workspace/);
  assert.match(output, /reset-session: removing workspace /);
  assert.match(output, /reset-session: removed workspace /);
});

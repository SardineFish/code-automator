import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
  await resetSession(workspacePath, {
    cwd: workspacePath,
    chdir(nextPath: string) {
      changedDirectoryTo = nextPath;
    }
  });

  await assert.rejects(() => access(workspacePath));
  assert.equal(changedDirectoryTo, root);
});

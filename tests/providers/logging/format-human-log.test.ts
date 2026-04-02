import assert from "node:assert/strict";
import test from "node:test";

import { formatHumanLogEntry, formatLocalTimestamp } from "../../../src/providers/logging/format-human-log.js";

test("formatLocalTimestamp renders local timestamps with numeric offsets", () => {
  assert.equal(
    formatLocalTimestamp("2026-04-02T12:34:56.789Z", "America/Los_Angeles"),
    "2026-04-02T05:34:56.789-07:00"
  );
  assert.equal(
    formatLocalTimestamp("2026-12-31T23:59:59.000Z", "America/New_York"),
    "2026-12-31T18:59:59.000-05:00"
  );
});

test("formatHumanLogEntry uses the bracketed prefix and preserves detail rendering", () => {
  assert.equal(
    formatHumanLogEntry(
      {
        timestamp: "2026-04-02T12:34:56.789Z",
        level: "warn",
        message: "Run failed",
        runId: "run-42",
        stderr: "line 1\nline 2"
      },
      "America/Los_Angeles"
    ),
    "[2026-04-02T05:34:56.789-07:00][warn] Run failed runId=run-42\n  stderr: line 1\n  stderr: line 2"
  );
});

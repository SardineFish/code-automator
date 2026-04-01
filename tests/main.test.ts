import assert from "node:assert/strict";
import test from "node:test";

import { renderHelloWorld } from "../src/app/main.js";

test("renderHelloWorld returns the placeholder output", () => {
  assert.equal(renderHelloWorld(), "Hello, world!\n");
});

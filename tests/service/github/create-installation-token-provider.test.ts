import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createInstallationTokenProvider } from "../../../src/app/providers/github-utils.js";

test("createInstallationTokenProvider signs a JWT with clientId and exchanges it for a token", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const dir = await mkdtemp(path.join(tmpdir(), "gao-key-"));
  const pemPath = path.join(dir, "app.pem");
  let receivedJwt = "";
  let receivedInstallationId = 0;

  await writeFile(pemPath, pem);

  const provider = createInstallationTokenProvider(pemPath, {
    async createInstallationAccessToken(jwt, installationId) {
      receivedJwt = jwt;
      receivedInstallationId = installationId;
      return { token: "installation-token" };
    }
  });

  const token = await provider.createInstallationToken("client-id", 42);
  const [, payload] = receivedJwt.split(".");
  const decodedPayload = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    iss: string;
  };

  assert.equal(token, "installation-token");
  assert.equal(receivedInstallationId, 42);
  assert.equal(decodedPayload.iss, "client-id");
});

import { readFile } from "node:fs/promises";

import type { GitHubInstallationTokenClient } from "../../providers/github/github-installation-token-client.js";
import { generateGitHubAppJwt } from "./generate-app-jwt.js";

export interface InstallationTokenProvider {
  createInstallationToken(clientId: string, installationId: number): Promise<string>;
}

export function createInstallationTokenProvider(
  privateKeyPath: string,
  client: GitHubInstallationTokenClient
): InstallationTokenProvider {
  let privateKeyPromise: Promise<string> | undefined;

  return {
    async createInstallationToken(clientId, installationId) {
      const privateKey = await loadPrivateKey(privateKeyPath, privateKeyPromise);
      privateKeyPromise ??= Promise.resolve(privateKey);
      const jwt = generateGitHubAppJwt(clientId, privateKey);
      const response = await client.createInstallationAccessToken(jwt, installationId);
      return response.token;
    }
  };
}

async function loadPrivateKey(
  privateKeyPath: string,
  cachedPromise: Promise<string> | undefined
): Promise<string> {
  if (cachedPromise) {
    return cachedPromise;
  }

  return readFile(privateKeyPath, "utf8");
}

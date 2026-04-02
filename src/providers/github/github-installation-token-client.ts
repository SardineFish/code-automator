export interface InstallationTokenResponse {
  token: string;
  expiresAt?: string;
}

export interface GitHubInstallationTokenClient {
  createInstallationAccessToken(jwt: string, installationId: number): Promise<InstallationTokenResponse>;
}

export const fetchGitHubInstallationTokenClient: GitHubInstallationTokenClient = {
  async createInstallationAccessToken(jwt, installationId) {
    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${jwt}`,
          "User-Agent": "github-agent-orchestrator",
          "X-GitHub-Api-Version": "2022-11-28"
        }
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub installation token request failed: ${response.status} ${body}`);
    }

    const payload = (await response.json()) as { token?: string; expires_at?: string };

    if (!payload.token) {
      throw new Error("GitHub installation token response did not include a token.");
    }

    return { token: payload.token, expiresAt: payload.expires_at };
  }
};

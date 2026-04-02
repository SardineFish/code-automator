import { createSign } from "node:crypto";

export function generateGitHubAppJwt(clientId: string, privateKeyPem: string, now = new Date()): string {
  const issuedAt = Math.floor(now.getTime() / 1000) - 60;
  const expiresAt = issuedAt + (9 * 60);
  const encodedHeader = encodeJwtPart({ alg: "RS256", typ: "JWT" });
  const encodedPayload = encodeJwtPart({ iat: issuedAt, exp: expiresAt, iss: clientId });
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign("RSA-SHA256");

  signer.update(unsignedToken);
  signer.end();

  const signature = signer.sign(privateKeyPem).toString("base64url");

  return `${unsignedToken}.${signature}`;
}

function encodeJwtPart(value: Record<string, number | string>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

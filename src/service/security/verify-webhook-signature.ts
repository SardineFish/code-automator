import { verifyGithubSignature } from "../../providers/signature/verify-github-signature.js";

export function verifyWebhookSignature(
  secret: string,
  body: Buffer,
  signatureHeader: string | undefined
): boolean {
  return verifyGithubSignature(secret, body, signatureHeader);
}

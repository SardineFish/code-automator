import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGithubSignature(
  secret: string,
  body: Buffer,
  signatureHeader: string | undefined
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const actualDigest = signatureHeader.slice("sha256=".length);
  const expectedDigest = createHmac("sha256", secret).update(body).digest("hex");

  if (actualDigest.length !== expectedDigest.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(actualDigest), Buffer.from(expectedDigest));
}

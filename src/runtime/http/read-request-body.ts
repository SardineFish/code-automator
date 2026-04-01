import type { IncomingMessage } from "node:http";

const MAX_WEBHOOK_BYTES = 1024 * 1024;

export class RequestBodyError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "RequestBodyError";
  }
}

export async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    totalBytes += buffer.length;

    if (totalBytes > MAX_WEBHOOK_BYTES) {
      throw new RequestBodyError(413, "Payload Too Large");
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

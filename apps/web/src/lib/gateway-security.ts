/** The API uses Fastify's 1 MiB body limit. Upload binary assets directly to storage. */
export const MAX_API_BODY_BYTES = 1024 * 1024;
export class BodyLimitError extends Error {}
export async function boundedBody(
  request: Request,
): Promise<ArrayBuffer | undefined> {
  if (!request.body) return undefined;
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_API_BODY_BYTES))
    throw new BodyLimitError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_API_BODY_BYTES) {
        await reader.cancel();
        throw new BodyLimitError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}
export function sameOriginRequest(request: Request, secure: boolean): boolean {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  if (!origin) return !mutation;
  try {
    return new URL(origin).origin === `${secure ? "https" : "http"}://${host}`;
  } catch {
    return false;
  }
}
export function sessionCookieNames(secure: boolean) {
  const prefix = secure ? "__Host-" : "";
  return {
    access: `${prefix}evseye-access`,
    refresh: `${prefix}evseye-refresh`,
  };
}

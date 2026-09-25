"use client";
let refreshInFlight: Promise<boolean> | null = null;
/** Browser requests use host-only HttpOnly cookies. This marker is UI state, never a credential. */
export const SESSION_MARKER = "cookie-session";
async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight)
    refreshInFlight = globalThis
      .fetch("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "same-origin",
      })
      .then((response) => response.ok)
      .finally(() => {
        refreshInFlight = null;
      });
  return refreshInFlight;
}
export async function sessionFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  // Presigned S3/MinIO requests must keep their original URL, headers and credentials.
  if (typeof input !== "string" || !input.startsWith("/api/v1/"))
    return globalThis.fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.delete("authorization");
  if (!headers.has("Accept-Language"))
    headers.set("Accept-Language", document.documentElement.lang || "en");
  const options = { ...init, headers, credentials: "same-origin" as const };
  const response = await globalThis.fetch(input, options);
  if (response.status !== 401 || input.startsWith("/api/v1/auth/"))
    return response;
  const recover = async () => {
    // Another tab may have rotated the host's cookies while this request waited.
    const retry = await globalThis.fetch(input, options);
    if (retry.status !== 401) return retry;
    return (await refreshSession()) ? globalThis.fetch(input, options) : retry;
  };
  return typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request("evseye-session-refresh", recover)
    : recover();
}

type UploadOptions = Readonly<{
  apiUrl: string;
  accessToken?: string | null;
}>;

type UploadIntent = {
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
};

function invalidIntent(): Error {
  return new Error("Invalid upload intent.");
}

function readIntent(value: unknown): UploadIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidIntent();
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.uploadUrl !== "string" ||
    !candidate.uploadUrl.trim() ||
    candidate.uploadUrl !== candidate.uploadUrl.trim()
  ) {
    throw invalidIntent();
  }

  const uploadHeaders = candidate.uploadHeaders;
  if (uploadHeaders === undefined) {
    return { uploadUrl: candidate.uploadUrl, uploadHeaders: {} };
  }
  if (
    !uploadHeaders ||
    typeof uploadHeaders !== "object" ||
    Array.isArray(uploadHeaders) ||
    Object.entries(uploadHeaders).some(
      ([, headerValue]) => typeof headerValue !== "string",
    )
  ) {
    throw invalidIntent();
  }

  return {
    uploadUrl: candidate.uploadUrl,
    uploadHeaders: uploadHeaders as Record<string, string>,
  };
}

function isAuthorizationHeader(headerName: string): boolean {
  return headerName.toLowerCase() === "authorization";
}

function hasContentTypeHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some(
    (headerName) => headerName.toLowerCase() === "content-type",
  );
}

function resolveTarget(
  uploadUrl: string,
  apiUrl: string,
): { url: string; requiresAuth: boolean } {
  if (uploadUrl.startsWith("//") || /^\/[\\/]/.test(uploadUrl)) {
    throw invalidIntent();
  }

  if (uploadUrl.startsWith("/")) {
    let apiOrigin: string;
    try {
      const api = new URL(apiUrl);
      if (api.protocol !== "http:" && api.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
      apiOrigin = api.origin;
    } catch {
      throw new Error("Invalid API URL.");
    }

    try {
      const resolved = new URL(uploadUrl, apiOrigin);
      if (resolved.origin !== apiOrigin) throw new Error("cross-origin target");
      return { url: resolved.href, requiresAuth: true };
    } catch {
      throw invalidIntent();
    }
  }

  try {
    const absolute = new URL(uploadUrl);
    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw invalidIntent();
  }
  return { url: uploadUrl, requiresAuth: false };
}

function prepareHeaders(
  uploadHeaders: Record<string, string>,
  requiresAuth: boolean,
  accessToken: string | null | undefined,
  file: File,
): Record<string, string> {
  const headers = { ...uploadHeaders };
  for (const headerName of Object.keys(headers)) {
    if (isAuthorizationHeader(headerName)) delete headers[headerName];
  }

  if (requiresAuth) {
    if (typeof accessToken !== "string" || !accessToken.trim()) {
      throw new Error("Authenticated upload requires an access token.");
    }
    headers.Authorization = `Bearer ${accessToken.trim()}`;
  }
  if (!hasContentTypeHeader(headers)) headers["Content-Type"] = file.type;
  return headers;
}

export async function uploadFile(
  intent: unknown,
  file: File,
  { apiUrl, accessToken }: UploadOptions,
): Promise<Response> {
  const { uploadUrl, uploadHeaders } = readIntent(intent);
  const target = resolveTarget(uploadUrl, apiUrl);
  const response = await fetch(target.url, {
    method: "PUT",
    headers: prepareHeaders(
      uploadHeaders,
      target.requiresAuth,
      accessToken,
      file,
    ),
    body: file,
    ...(target.requiresAuth ? { redirect: "error" as const } : {}),
  });
  if (!response.ok)
    throw new Error(`Upload failed with status ${response.status}.`);
  return response;
}

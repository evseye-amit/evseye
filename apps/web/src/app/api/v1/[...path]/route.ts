import { cookies } from "next/headers";
import {
  apiInternalUrl,
  clientGatewayHeaders,
} from "../../../../lib/client-context-server";
import {
  BodyLimitError,
  boundedBody,
  sameOriginRequest,
  sessionCookieNames,
} from "../../../../lib/gateway-security";
export const dynamic = "force-dynamic";

async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const failure = (message: string, status: number) =>
    Response.json(
      { error: { message } },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  if (
    path.some(
      (part) => !part || part === "." || part === ".." || /[\\/]/.test(part),
    )
  )
    return failure("Invalid API path.", 400);
  // Secure by default, including optimized builds. Local HTTP must explicitly opt out.
  const secure = process.env.SESSION_COOKIE_SECURE !== "false";
  if (!sameOriginRequest(request, secure))
    return failure("Invalid request origin.", 403);
  const jar = await cookies();
  const names = sessionCookieNames(secure);
  const clearSession = () => {
    for (const name of Object.values(names))
      jar.set(name, "", {
        httpOnly: true,
        secure,
        sameSite: "strict",
        path: "/",
        maxAge: 0,
      });
  };
  const endpoint = path.join("/");
  const logout = endpoint === "auth/logout" && request.method === "POST";
  const refresh = endpoint === "auth/refresh" && request.method === "POST";
  try {
    let body = await boundedBody(request);
    const headers = new Headers(
      clientGatewayHeaders(request.headers.get("host") ?? ""),
    );
    for (const name of ["content-type", "accept"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    // Never trust a browser-supplied Authorization header or forward arbitrary cookies.
    const accessToken = jar.get(names.access)?.value;
    if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
    if (refresh || logout) {
      const refreshToken = jar.get(names.refresh)?.value;
      if (!refreshToken) {
        clearSession();
        return logout
          ? new Response(null, { status: 204 })
          : failure("Session is unavailable.", 401);
      }
      headers.set("content-type", "application/json");
      body = new TextEncoder().encode(JSON.stringify({ refreshToken })).buffer;
    }
    const upstream = await fetch(
      `${apiInternalUrl()}/${path.map(encodeURIComponent).join("/")}${new URL(request.url).search}`,
      {
        method: request.method,
        headers,
        body,
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (logout) clearSession();
    if (
      (endpoint === "auth/otp/verify" || refresh) &&
      request.method === "POST" &&
      upstream.ok
    ) {
      const { data } = await upstream.json();
      if (
        typeof data?.accessToken !== "string" ||
        typeof data?.refreshToken !== "string"
      )
        return failure("Invalid authentication response.", 502);
      // Session cookies intentionally have no Domain or persistent Max-Age.
      for (const [name, value] of [
        [names.access, data.accessToken],
        [names.refresh, data.refreshToken],
      ])
        jar.set(name, value, {
          httpOnly: true,
          secure,
          sameSite: "strict",
          path: "/",
        });
      return Response.json(
        { data: { authenticated: true } },
        { status: upstream.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (refresh && upstream.status === 401) clearSession();
    const responseHeaders = new Headers({ "Cache-Control": "no-store" });
    for (const name of [
      "content-type",
      "content-disposition",
      "x-request-id",
      "retry-after",
    ]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    if (logout) clearSession();
    return error instanceof BodyLimitError
      ? failure("Request body exceeds 1 MB.", 413)
      : failure("Service temporarily unavailable.", 503);
  }
}
export {
  proxy as GET,
  proxy as POST,
  proxy as PATCH,
  proxy as PUT,
  proxy as DELETE,
  proxy as HEAD,
};

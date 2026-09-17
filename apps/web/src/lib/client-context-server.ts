import "server-only";
import { headers } from "next/headers";
import type { ClientAppearance } from "./client-context";
export function apiInternalUrl() {
  return process.env.API_INTERNAL_URL ?? "http://localhost:3000/api/v1";
}
export function clientGatewayHeaders(host: string): Record<string, string> {
  const secret = process.env.CLIENT_PROXY_SECRET;
  if (!secret) throw new Error("Client gateway is not configured.");
  return { "x-client-host": host, "x-client-proxy-secret": secret };
}
export async function getClientAppearance(): Promise<ClientAppearance | null> {
  try {
    const host = (await headers()).get("host") ?? "";
    const response = await fetch(`${apiInternalUrl()}/public/client-context`, {
      headers: clientGatewayHeaders(host),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    return (await response.json()).data as ClientAppearance;
  } catch {
    return null;
  }
}

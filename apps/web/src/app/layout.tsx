import type { Metadata } from "next";
import "./globals.css";
import { getClientAppearance } from "../lib/client-context-server";
import { ClientProvider } from "./components/client-provider";
import { LanguageSwitcher, LocaleProvider, LocalizedText } from "./components/locale-provider";
import { LOCALE_COOKIE, supportedLocale } from "../lib/i18n";
import { DEFAULT_CLIENT_APPEARANCE } from "../lib/client-context";
import { cookies, headers } from "next/headers";

// Branding and workspace resolution depend on the request hostname. Rendering
// this layout at build time would cache an unavailable workspace for localhost.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "EVs Eye Operations",
  description: "EV fleet operations console",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const requestHeaders = await headers();
  const appearance = await getClientAppearance();
  const locale = supportedLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const requestPath = requestHeaders.get("next-url") ?? requestHeaders.get("x-invoke-path") ?? "";
  const host = requestHeaders.get("host") ?? "";
  const isPlatformRoute = requestPath === "/platform" || requestPath.startsWith("/platform/") || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full flex flex-col"><LocaleProvider initialLocale={locale}>{appearance || isPlatformRoute ? <ClientProvider initial={appearance ?? DEFAULT_CLIENT_APPEARANCE}>{children}</ClientProvider> : <main className="auth-shell"><section className="auth-card"><div className="language-login-row"><LanguageSwitcher /></div><h1><LocalizedText text="Workspace unavailable" /></h1><p><LocalizedText text="This address is not available, or the service is temporarily offline. Check the address and try again." /></p></section></main>}</LocaleProvider></body>
    </html>
  );
}

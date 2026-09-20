import type { Metadata } from "next";
import "./globals.css";
import { getClientAppearance } from "../lib/client-context-server";
import { ClientProvider } from "./components/client-provider";

// Branding and workspace resolution depend on the request hostname. Rendering
// this layout at build time would cache an unavailable workspace for localhost.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "EVs Eye Operations",
  description: "EV fleet operations console",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const appearance = await getClientAppearance();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{appearance ? <ClientProvider initial={appearance}>{children}</ClientProvider> : <main className="auth-shell"><section className="auth-card"><h1>Workspace unavailable</h1><p>This address is not available, or the service is temporarily offline. Check the address and try again.</p></section></main>}</body>
    </html>
  );
}

"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  DEFAULT_CLIENT_APPEARANCE,
  type ClientAppearance,
} from "../../lib/client-context";
const ClientAppearanceContext = createContext<{ appearance: ClientAppearance; hostClient: boolean; setAppearance: (value: ClientAppearance) => void }>({
  appearance: DEFAULT_CLIENT_APPEARANCE,
  hostClient: false,
  setAppearance: () => {},
});
export function useClientAppearance() {
  return useContext(ClientAppearanceContext);
}
export function ClientProvider({
  initial,
  children,
}: {
  initial: ClientAppearance;
  children: ReactNode;
}) {
  const [appearance, setAppearance] = useState(initial);
  const b = appearance.branding;
  useEffect(() => {
    // One-time cleanup after migrating credentials into HttpOnly cookies.
    sessionStorage.removeItem("evs-eye-access-token");
    sessionStorage.removeItem("evs-eye-refresh-token");
  }, []);
  useEffect(() => {
    const existing =
      document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.href = b.faviconUrl || "/favicon.ico";
    if (existing) existing.remove();
    document.head.appendChild(icon);
    return () => {
      icon.remove();
      if (existing) document.head.appendChild(existing);
    };
  }, [b.faviconUrl]);
  const safeColor = (value: string, fallback: string) =>
    /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  const primary = safeColor(b.primaryColor, "#176b4c");
  const foregroundFor = (color: string) => {
    const channels = color.slice(1).match(/../g)!.map((part) => {
      const c = parseInt(part, 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .179 ? "#000000" : "#ffffff";
  };
  const secondary = safeColor(b.secondaryColor, "#e4f2e9");
  const style = {
    "--green": primary,
    "--green-dark": primary,
    "--client-primary": primary,
    "--client-on-primary": foregroundFor(primary),
    "--client-secondary": secondary,
    "--client-on-secondary": foregroundFor(secondary),
    "--client-accent": safeColor(b.accentColor, "#27865f"),
  } as CSSProperties;
  return (
    <ClientAppearanceContext.Provider
      value={{ appearance, hostClient: Boolean(initial.client), setAppearance }}
    >
      <div className="client-theme-root" style={style}>
        {children}
      </div>
    </ClientAppearanceContext.Provider>
  );
}

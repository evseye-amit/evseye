"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
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
  return (
    <ClientAppearanceContext.Provider
      value={{ appearance, hostClient: Boolean(initial.client), setAppearance }}
    >
      <div className="client-theme-root">
        {children}
      </div>
    </ClientAppearanceContext.Provider>
  );
}

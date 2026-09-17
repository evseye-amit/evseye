export interface ClientAppearance {
  client: { displayName: string } | null;
  branding: {
    logoUrl: string | null;
    faviconUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    loginTitle: string;
    loginSubtitle: string;
    supportEmail: string | null;
    supportPhone: string | null;
  };
}
export const DEFAULT_CLIENT_APPEARANCE: ClientAppearance = {
  client: null,
  branding: {
    logoUrl: null,
    faviconUrl: null,
    primaryColor: "#176b4c",
    secondaryColor: "#e4f2e9",
    accentColor: "#27865f",
    loginTitle: "Welcome back",
    loginSubtitle: "Sign in to your EV fleet workspace.",
    supportEmail: null,
    supportPhone: null,
  },
};

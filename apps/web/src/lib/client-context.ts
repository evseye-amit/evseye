export interface ClientAppearance {
  client: { displayName: string } | null;
  branding: {
    logoUrl: string | null;
    faviconUrl: string | null;
    supportEmail: string | null;
    supportPhone: string | null;
  };
}
export const DEFAULT_CLIENT_APPEARANCE: ClientAppearance = {
  client: null,
  branding: {
    logoUrl: null,
    faviconUrl: null,
    supportEmail: null,
    supportPhone: null,
  },
};

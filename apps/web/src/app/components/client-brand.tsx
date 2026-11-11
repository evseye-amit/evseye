"use client";
import { sessionFetch as fetch } from "../../lib/session-fetch";
import { useEffect, useState } from 'react';
import { UiIcon } from './ui-icon';
import { useClientAppearance } from './client-provider';
export function ClientBrand({ token, landing = false, hero = false }: { companyCode?: string; token?: string; landing?: boolean; hero?: boolean }) {
  const { appearance, setAppearance } = useClientAppearance();
  const [failedImage, setFailedImage] = useState('');
  useEffect(() => {
    // The login-card instance renews the shared branding URLs.
    if (hero) return;
    const abort = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch(token ? '/api/v1/client/identity/context' : '/api/v1/public/client-context', { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: abort.signal, cache: 'no-store' });
        if (response.ok) setAppearance((await response.json()).data);
      } catch { /* Keep server-provided branding on transient network failures. */ }
    };
    void refresh();
    // Presigned image URLs expire; renew while the page remains open.
    const timer = setInterval(() => void refresh(), 45_000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [token, setAppearance, hero]);
  const logo = appearance.branding.logoUrl;
  const name = appearance.client?.displayName ?? 'Evs Eye';
  return <div className={`sa-brand${landing ? ' client-landing-brand' : ''}${hero ? ' client-hero-brand' : ''}`}>
    {logo && logo !== failedImage ? <img className="client-brand-logo" src={logo} alt={`${name} logo`} onError={() => setFailedImage(logo)} /> : <span><UiIcon name="eye" /></span>}
    {!landing && !hero && <div><strong>{name}</strong><small>OPERATIONS</small></div>}
  </div>;
}

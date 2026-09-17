"use client";

import { useEffect, useState } from "react";
import { UiIcon } from "./ui-icon";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api/v1";

export function ClientBrand({ companyCode = "", token, landing = false }: { companyCode?: string; token?: string; landing?: boolean }) {
  const [brand, setBrand] = useState<{ name: string; logoUrl: string | null } | null>(null);
  const [failedImage, setFailedImage] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      if (!token && !companyCode.trim()) { setBrand(null); return; }
      try {
        const path = token ? "/client-branding" : `/client-branding/public?companyCode=${encodeURIComponent(companyCode.trim())}`;
        const response = await fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: abort.signal });
        const body = response.ok ? await response.json() : null;
        setBrand(body?.data ?? null);
      } catch { if (!abort.signal.aborted) setBrand(null); }
    }, token ? 0 : 400);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [companyCode, token]);
  const logo = brand?.logoUrl && brand.logoUrl !== failedImage ? brand.logoUrl : null;
  return <div className={`sa-brand${landing ? " client-landing-brand" : ""}`}>
    {logo ? <img className="client-brand-logo" src={logo} alt={`${brand?.name ?? "Client"} logo`} onError={() => setFailedImage(logo)} /> : <span><UiIcon name="eye" /></span>}
    <div><strong>{brand?.name || "Evs Eye"}</strong><small>OPERATIONS</small></div>
  </div>;
}

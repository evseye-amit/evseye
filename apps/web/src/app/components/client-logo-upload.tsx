"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export function ClientLogoUpload({ file, savedUrl, onChange }: {
  file: File | null;
  savedUrl?: string;
  onChange: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => file ? URL.createObjectURL(file) : "", [file]);
  const [error, setError] = useState("");
  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);
  const imageUrl = file ? preview : savedUrl;
  return <section className="client-logo-upload">
    <label className="sa-logo-input">
      Client logo (recommended)
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
        const selected = event.target.files?.[0];
        if (!selected) return;
        if (!["image/png", "image/jpeg", "image/webp"].includes(selected.type) || selected.size > 2 * 1024 * 1024 || !selected.size) {
          setError("Choose a PNG, JPEG, or WebP image up to 2 MB.");
          event.target.value = "";
          return;
        }
        setError("");
        onChange(selected);
      }} />
      <small>PNG, JPEG, or WebP · Maximum 2 MB. A square logo works best.</small>
    </label>
    {error && <p className="error" role="alert">{error}</p>}
    {imageUrl && <img className="sa-logo-preview" src={imageUrl} alt="Client logo preview" />}
    {file && <button type="button" className="secondary" onClick={() => { onChange(null); setError(""); if (inputRef.current) inputRef.current.value = ""; }}>Cancel selected upload</button>}
    {!imageUrl && <p className="sa-field-warning">If you do not provide a logo, the Client Operations landing page and dashboard will display the default logo.</p>}
    <p className="muted">You can upload or update the logo later by editing the client information in Business Details.</p>
  </section>;
}

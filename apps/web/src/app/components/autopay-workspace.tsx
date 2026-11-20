"use client";

import { useState } from "react";
import { PaymentOperations } from "./payment-operations";
import { WalletAutoPayHistory } from "./wallet-autopay-history";
import { WalletAutoPaySettings } from "./wallet-autopay-settings";
import { DeploymentAutoPaySettings } from "./deployment-autopay-settings";
import { requestNavigation } from "./unsaved-changes";

export function AutoPayWorkspace({ identityKey, refreshKey }: { identityKey: string; refreshKey: number }) {
  const [tab, setTab] = useState<"mandates" | "history">("mandates");
  const [unified, setUnified] = useState<boolean | null>(null);
  const [settings, setSettings] = useState(false);
  return <div className="autopay-workspace">
    {settings ? <>
      <button type="button" className="secondary autopay-back" onClick={() => requestNavigation(() => { setSettings(false); setTab("mandates"); })}>← Back to mandates</button>
      {unified === false && <DeploymentAutoPaySettings key={`onboarding-${identityKey}-${refreshKey}`} />}
      <WalletAutoPaySettings key={refreshKey} onRollout={setUnified} />
    </> : <div className="autopay-heading">
      <div><h2>AutoPay overview</h2><p className="muted">Manage rider mandates and automatic wallet recharges.</p></div>
      <button type="button" className="secondary" aria-label="AutoPay settings" onClick={() => setSettings(true)}>⚙ Settings</button>
    </div>}
    <div hidden={settings}>
      <div className="autopay-tabs" role="tablist" aria-label="AutoPay views">
        {(["mandates", "history"] as const).map(value => <button key={value} id={`autopay-tab-${value}`} role="tab" type="button" aria-selected={tab === value} aria-controls={`autopay-panel-${value}`} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const next = event.key === "Home" ? "mandates" : event.key === "End" ? "history" : value === "mandates" ? "history" : "mandates";
            setTab(next); document.getElementById(`autopay-tab-${next}`)?.focus();
          }
        }}>{value === "mandates" ? "Mandates" : "Recharge history"}</button>)}
      </div>
      <div id="autopay-panel-mandates" role="tabpanel" aria-labelledby="autopay-tab-mandates" hidden={tab !== "mandates"}>
        <PaymentOperations identityKey={identityKey} refreshKey={refreshKey} standalone initialView="autopay" />
      </div>
      <div id="autopay-panel-history" role="tabpanel" aria-labelledby="autopay-tab-history" hidden={tab !== "history"}>
        <WalletAutoPayHistory />
      </div>
    </div>
  </div>;
}

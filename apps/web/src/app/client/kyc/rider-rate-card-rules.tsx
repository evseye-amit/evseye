"use client";

import { useEffect, useState } from "react";
import { sessionFetch } from "../../../lib/session-fetch";

type Rate = {
  id: string;
  rentalPeriodType: string;
  amount: string;
  includedKm?: string | null;
  extraKmRate?: string | null;
  taxable: boolean;
  isActive: boolean;
};
type Rule = {
  id: string;
  code: string;
  name: string;
  amount: string;
  isActive?: boolean;
  city?: string | null;
  hubId?: string | null;
  oemId?: string | null;
  clientWorkPartnerId?: string | null;
  minVehicleAgeMonths?: number | null;
  maxVehicleAgeMonths?: number | null;
};
type Version = {
  id: string;
  version: number;
  effectiveFrom: string;
  status: string;
  rentalRates: Rate[];
  fees?: Rule[];
  deposits?: Rule[];
};
type RuleOptions = {
  oems: { id: string; displayName: string; code: string }[];
  hubs: { id: string; name: string; city?: string }[];
  workPartners: { id: string; name: string; code: string }[];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(`/api/v1/rider-rate-cards${path}`, {
    cache: "no-store",
    ...init,
  });
  const body = (await response.json()) as {
    data?: T;
    message?: string;
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(
      body.error?.message ??
        body.message ??
        "Unable to update rider rate cards.",
    );
  return (body.data ?? body) as T;
}

async function contextRequest<T>(path: string): Promise<T> {
  const response = await sessionFetch(`/api/v1${path}`, { cache: "no-store" });
  const body = (await response.json()) as {
    data?: T;
    message?: string;
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(
      body.error?.message ?? body.message ?? "Unable to load pricing options.",
    );
  return (body.data ?? body) as T;
}

function RuleEditorContent({
  version,
  canManage,
  busy,
  onSaved,
}: {
  version: Version;
  canManage: boolean;
  busy: boolean;
  onSaved: () => void;
}) {
  const [options, setOptions] = useState<RuleOptions>({
    oems: [],
    hubs: [],
    workPartners: [],
  });
  const [kind, setKind] = useState<"deposit" | "fee">("deposit");
  const [editing, setEditing] = useState<string | null>(null);
  const [rule, setRule] = useState({
    amount: "",
    city: "",
    hubId: "",
    oemId: "",
    clientWorkPartnerId: "",
    minVehicleAgeMonths: "",
    maxVehicleAgeMonths: "",
  });
  useEffect(() => {
    void Promise.all([
      contextRequest<RuleOptions["oems"]>("/fleets/onboarding-options"),
      contextRequest<RuleOptions["hubs"]>("/hubs"),
      contextRequest<RuleOptions["workPartners"]>(
        "/client/work-partners/active",
      ),
    ])
      .then(([fleet, hubs, workPartners]) =>
        setOptions({
          oems: (fleet as unknown as { oems: RuleOptions["oems"] }).oems,
          hubs,
          workPartners,
        }),
      )
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!editing) return;
    const found = [...(version.deposits ?? []), ...(version.fees ?? [])].find(
      (item) => item.id === editing,
    );
    if (found)
      setRule({
        amount: found.amount,
        city: found.city ?? "",
        hubId: found.hubId ?? "",
        oemId: found.oemId ?? "",
        clientWorkPartnerId: found.clientWorkPartnerId ?? "",
        minVehicleAgeMonths:
          found.minVehicleAgeMonths == null
            ? ""
            : String(found.minVehicleAgeMonths),
        maxVehicleAgeMonths:
          found.maxVehicleAgeMonths == null
            ? ""
            : String(found.maxVehicleAgeMonths),
      });
  }, [editing, version.deposits, version.fees]);
  async function addRule(event: React.FormEvent) {
    event.preventDefault();
    const current = [
      ...(version.deposits ?? []).map((item) => ({
        item,
        type: "deposit" as const,
      })),
      ...(version.fees ?? []).map((item) => ({ item, type: "fee" as const })),
    ].find(({ item }) => item.id === editing);
    const scope = {
      city: rule.city || undefined,
      hubId: rule.hubId || undefined,
      oemId: rule.oemId || undefined,
      clientWorkPartnerId: rule.clientWorkPartnerId || undefined,
      minVehicleAgeMonths: rule.minVehicleAgeMonths
        ? Number(rule.minVehicleAgeMonths)
        : undefined,
      maxVehicleAgeMonths: rule.maxVehicleAgeMonths
        ? Number(rule.maxVehicleAgeMonths)
        : undefined,
    };
    if (current)
      await changeRule(
        { ...current.item, amount: rule.amount, ...scope },
        current.type,
        true,
      );
    else {
      const payload = {
        code:
          kind === "deposit"
            ? `VEHICLE-SECURITY-${Date.now()}`
            : `ONBOARDING-FEE-${Date.now()}`,
        name:
          kind === "deposit" ? "Vehicle security deposit" : "Onboarding fee",
        amount: rule.amount,
        ...(kind === "deposit"
          ? { depositType: "VEHICLE_SECURITY", waiverAmount: "0.00" }
          : {
              chargeType: "ONBOARDING_FEE",
              nature: "ONE_TIME",
              eligibility: "ONCE_PER_CLIENT_RIDER_RELATIONSHIP",
              taxable: false,
              priceIncludesTax: false,
            }),
        ...scope,
      };
      await request(
        `/versions/${version.id}/${kind === "deposit" ? "deposits" : "fees"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      onSaved();
    }
    setEditing(null);
    setRule({
      amount: "",
      city: "",
      hubId: "",
      oemId: "",
      clientWorkPartnerId: "",
      minVehicleAgeMonths: "",
      maxVehicleAgeMonths: "",
    });
  }
  async function changeRule(
    item: Rule,
    type: "deposit" | "fee",
    active: boolean,
  ) {
    const path = type === "deposit" ? "deposits" : "fees";
    await request(`/versions/${version.id}/${path}/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: item.code,
        name: item.name,
        amount: item.amount,
        isActive: active,
        ...(type === "deposit"
          ? { depositType: "VEHICLE_SECURITY", waiverAmount: "0.00" }
          : {
              chargeType: "ONBOARDING_FEE",
              nature: "ONE_TIME",
              eligibility: "ONCE_PER_CLIENT_RIDER_RELATIONSHIP",
              taxable: false,
              priceIncludesTax: false,
            }),
        city: item.city || undefined,
        hubId: item.hubId || undefined,
        oemId: item.oemId || undefined,
        clientWorkPartnerId: item.clientWorkPartnerId || undefined,
        minVehicleAgeMonths: item.minVehicleAgeMonths ?? undefined,
        maxVehicleAgeMonths: item.maxVehicleAgeMonths ?? undefined,
      }),
    });
    setEditing(null);
    onSaved();
  }
  if (!canManage || version.status !== "DRAFT") return null;
  const deposits = version.deposits ?? [];
  const fees = version.fees ?? [];
  return (
    <details className="kyc-rule-editor">
      <summary>Manage targeted rules</summary>
      <div className="kyc-rule-list">
        {[
          ...deposits.map((item) => ({ ...item, type: "Deposit" as const })),
          ...fees.map((item) => ({ ...item, type: "Fee" as const })),
        ].map((item) => (
          <div key={item.id} className="kyc-rule-row">
            <span
              className={`status ${item.isActive === false ? "status-inactive" : "status-draft"}`}
            >
              {item.type}: INR {item.amount}{" "}
              {item.city ? `· ${item.city}` : "· Default"}
            </span>
            <button
              type="button"
              className="secondary table-action"
              onClick={() => setEditing(editing === item.id ? null : item.id)}
            >
              {editing === item.id ? "Close" : "Edit"}
            </button>
            {item.isActive !== false && (
              <button
                type="button"
                className="danger table-action"
                disabled={busy}
                onClick={() =>
                  void changeRule(
                    item,
                    item.type === "Deposit" ? "deposit" : "fee",
                    false,
                  )
                }
              >
                Deactivate
              </button>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <p className="muted">Edit the rule in the form below, then save it.</p>
      )}
      <form className="form-grid" onSubmit={addRule}>
        <label>
          Rule type
          <select
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as "deposit" | "fee")
            }
          >
            <option value="deposit">Security deposit</option>
            <option value="fee">Onboarding fee</option>
          </select>
        </label>
        <label>
          Amount (INR)
          <input
            required
            inputMode="decimal"
            value={rule.amount}
            onChange={(event) =>
              setRule({ ...rule, amount: event.target.value })
            }
          />
        </label>
        <label>
          City
          <input
            value={rule.city}
            onChange={(event) => setRule({ ...rule, city: event.target.value })}
          />
        </label>
        <label>
          Hub
          <select
            value={rule.hubId}
            onChange={(event) =>
              setRule({ ...rule, hubId: event.target.value })
            }
          >
            <option value="">Any hub</option>
            {options.hubs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          OEM
          <select
            value={rule.oemId}
            onChange={(event) =>
              setRule({ ...rule, oemId: event.target.value })
            }
          >
            <option value="">Any OEM</option>
            {options.oems?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName} ({item.code})
              </option>
            ))}
          </select>
        </label>
        <label>
          Work partner
          <select
            value={rule.clientWorkPartnerId}
            onChange={(event) =>
              setRule({ ...rule, clientWorkPartnerId: event.target.value })
            }
          >
            <option value="">Any work partner</option>
            {options.workPartners.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.code})
              </option>
            ))}
          </select>
        </label>
        <label>
          Min vehicle age (months)
          <input
            type="number"
            min="0"
            value={rule.minVehicleAgeMonths}
            onChange={(event) =>
              setRule({ ...rule, minVehicleAgeMonths: event.target.value })
            }
          />
        </label>
        <label>
          Max vehicle age (months)
          <input
            type="number"
            min="0"
            value={rule.maxVehicleAgeMonths}
            onChange={(event) =>
              setRule({ ...rule, maxVehicleAgeMonths: event.target.value })
            }
          />
        </label>
        <button disabled={busy}>
          {editing ? "Save rule" : "Add targeted rule"}
        </button>
      </form>
    </details>
  );
}

function PricingPreview({ version }: { version: Version }) {
  const [input, setInput] = useState({
    city: "",
    hubId: "",
    oemId: "",
    workPartnerId: "",
    ageMonths: "",
  });
  const [options, setOptions] = useState<RuleOptions>({
    oems: [],
    hubs: [],
    workPartners: [],
  });
  const [result, setResult] = useState<{
    fees: { name: string; amount: string; reason: string }[];
    deposits: { name: string; amount: string; reason: string }[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void Promise.all([
      contextRequest<{ oems: RuleOptions["oems"] }>(
        "/fleets/onboarding-options",
      ),
      contextRequest<RuleOptions["hubs"]>("/hubs"),
      contextRequest<RuleOptions["workPartners"]>(
        "/client/work-partners/active",
      ),
    ])
      .then(([fleet, hubs, workPartners]) =>
        setOptions({ oems: fleet.oems, hubs, workPartners }),
      )
      .catch(() => undefined);
  }, []);
  async function preview(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      setResult(
        (await request(`/preview-rules`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            versionId: version.id,
            city: input.city || null,
            hubId: input.hubId || null,
            oemId: input.oemId || null,
            workPartnerId: input.workPartnerId || null,
            ageMonths: input.ageMonths ? Number(input.ageMonths) : null,
          }),
        })) as typeof result,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="kyc-rule-editor">
      <summary>Preview pricing resolution</summary>
      <form className="form-grid" onSubmit={preview}>
        <label>
          City
          <input
            value={input.city}
            onChange={(event) =>
              setInput({ ...input, city: event.target.value })
            }
          />
        </label>
        <label>
          Vehicle age (months)
          <input
            type="number"
            min="0"
            value={input.ageMonths}
            onChange={(event) =>
              setInput({ ...input, ageMonths: event.target.value })
            }
          />
        </label>
        <label>
          Hub
          <select
            value={input.hubId}
            onChange={(event) =>
              setInput({ ...input, hubId: event.target.value })
            }
          >
            <option value="">Any hub</option>
            {options.hubs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          OEM
          <select
            value={input.oemId}
            onChange={(event) =>
              setInput({ ...input, oemId: event.target.value })
            }
          >
            <option value="">Any OEM</option>
            {options.oems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName} ({item.code})
              </option>
            ))}
          </select>
        </label>
        <label>
          Work partner
          <select
            value={input.workPartnerId}
            onChange={(event) =>
              setInput({ ...input, workPartnerId: event.target.value })
            }
          >
            <option value="">Any work partner</option>
            {options.workPartners.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.code})
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy}>Preview</button>
      </form>
      {result && (
        <div className="kyc-preview-result">
          <strong>Selected pricing</strong>
          {[
            ...result.deposits.map((item) => ({
              ...item,
              type: "Security deposit",
            })),
            ...result.fees.map((item) => ({ ...item, type: "Onboarding fee" })),
          ].map((item) => (
            <p key={`${item.type}-${item.name}`}>
              <b>
                {item.type}: INR {item.amount}
              </b>
              <br />
              <small>{item.reason}</small>
            </p>
          ))}
        </div>
      )}
    </details>
  );
}

export function RuleEditor(props: {
  version: Version;
  canManage: boolean;
  busy: boolean;
  onSaved: () => void;
}) {
  return (
    <>
      <PricingPreview version={props.version} />
      <RuleEditorContent {...props} />
    </>
  );
}

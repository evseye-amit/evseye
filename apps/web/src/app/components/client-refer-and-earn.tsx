"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { sessionFetch } from "../../lib/session-fetch";
import { QRCodeSVG } from "qrcode.react";
import { ClientDataTable, type ClientColumn } from "./client-data-table";
import { ClientFormDialog } from "./client-form-dialog";

type Milestone = { milestoneType: string; operator: string; targetValue: string; sequence: number; mandatory: boolean };
type CampaignForm = {
  code: string; name: string; description: string; shareMessageTemplate: string; startAt: string; endAt: string;
  registrationValidityDays: string; qualificationValidityDays: string;
  referrerRewardType: string; referrerRewardValue: string; refereeRewardType: string; refereeRewardValue: string;
  maxReferralsPerRider: string; referralLimitPeriod: string; maxQualifiedReferralsPerRider: string;
  maxRewardPerRider: string; campaignBudget: string; currency: string; milestones: Milestone[];
};
type Campaign = Omit<CampaignForm, "startAt" | "endAt" | "registrationValidityDays" | "qualificationValidityDays" | "maxReferralsPerRider" | "maxQualifiedReferralsPerRider" | "milestones"> & {
  id: string; status: string; startAt: string; endAt: string; registrationValidityDays: number;
  qualificationValidityDays: number; maxReferralsPerRider: number | null;
  maxQualifiedReferralsPerRider: number | null; milestones: Array<Milestone & { id: string }>;
};
type CampaignPage = { items: Campaign[]; meta: { total: number } };
const milestoneTypes = ["KYC_VERIFIED", "RIDER_ACTIVATED", "VEHICLE_ALLOCATED", "ACTIVE_DAYS", "COMPLETED_RIDES", "COMPLETED_DELIVERIES", "ATTENDANCE_DAYS", "TRAINING_COMPLETED", "FIRST_PAYMENT"];
const oneTimeMilestones = ["KYC_VERIFIED", "RIDER_ACTIVATED", "VEHICLE_ALLOCATED", "TRAINING_COMPLETED", "FIRST_PAYMENT"];
const rewardTypes = ["CASH", "WALLET_CREDIT", "BONUS", "COUPON", "SERVICE_CREDIT", "RENTAL_CREDIT", "SWAP_CREDIT", "POINTS", "OTHER"];
const formSteps = ["Campaign", "Rewards", "Qualification", "Share message"];
const shareTemplates = [
  { name: "Simple invitation", content: "Join as a rider using my EVsEye referral. Use code {{referralCode}} or join using {{referralLink}}." },
  { name: "Friendly invitation", content: "I thought you might like to join our rider network. Use my code {{referralCode}} when you sign up: {{referralLink}}" },
  { name: "Short message", content: "Join as a rider with my referral code {{referralCode}}: {{referralLink}}" },
];
const sampleReferralCode = "EVS-ABCD2345";
const sampleReferralLink = `https://example.com/rider/referral?code=${sampleReferralCode}`;
const label = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
const localDateTime = (value: string) => {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};
const emptyForm = (): CampaignForm => ({
  code: "", name: "", description: "", shareMessageTemplate: shareTemplates[0].content,
  startAt: localDateTime(new Date().toISOString()),
  endAt: localDateTime(new Date(Date.now() + 30 * 86400000).toISOString()),
  registrationValidityDays: "30", qualificationValidityDays: "30", referrerRewardType: "CASH",
  referrerRewardValue: "0", refereeRewardType: "", refereeRewardValue: "0", maxReferralsPerRider: "",
  referralLimitPeriod: "LIFETIME", maxQualifiedReferralsPerRider: "", maxRewardPerRider: "",
  campaignBudget: "", currency: "INR", milestones: [{ milestoneType: "RIDER_ACTIVATED", operator: "GTE", targetValue: "1", sequence: 1, mandatory: true }],
});
const formFrom = (campaign: Campaign): CampaignForm => ({
  ...emptyForm(), ...campaign, startAt: localDateTime(campaign.startAt), endAt: localDateTime(campaign.endAt),
  registrationValidityDays: String(campaign.registrationValidityDays), qualificationValidityDays: String(campaign.qualificationValidityDays),
  maxReferralsPerRider: campaign.maxReferralsPerRider === null ? "" : String(campaign.maxReferralsPerRider),
  maxQualifiedReferralsPerRider: campaign.maxQualifiedReferralsPerRider === null ? "" : String(campaign.maxQualifiedReferralsPerRider),
  referrerRewardType: campaign.referrerRewardType ?? "", refereeRewardType: campaign.refereeRewardType ?? "",
  maxRewardPerRider: campaign.maxRewardPerRider ?? "", campaignBudget: campaign.campaignBudget ?? "",
  description: campaign.description ?? "", shareMessageTemplate: campaign.shareMessageTemplate ?? shareTemplates[0].content,
  milestones: campaign.milestones.map(({ milestoneType, operator, targetValue, sequence, mandatory }) => ({ milestoneType, operator, targetValue: String(targetValue), sequence, mandatory })),
});
function payloadOf(form: CampaignForm) {
  const optionalNumber = (value: string) => value.trim() ? Number(value) : undefined;
  const optionalText = (value: string) => value.trim() || undefined;
  return {
    code: form.code.trim().toUpperCase(), name: form.name.trim(),
    description: optionalText(form.description), shareMessageTemplate: optionalText(form.shareMessageTemplate),
    startAt: new Date(form.startAt).toISOString(), endAt: new Date(form.endAt).toISOString(),
    registrationValidityDays: Number(form.registrationValidityDays), qualificationValidityDays: Number(form.qualificationValidityDays),
    referrerRewardType: form.referrerRewardType || undefined, referrerRewardValue: form.referrerRewardValue,
    refereeRewardType: form.refereeRewardType || undefined, refereeRewardValue: form.refereeRewardValue,
    maxReferralsPerRider: optionalNumber(form.maxReferralsPerRider), referralLimitPeriod: form.referralLimitPeriod,
    maxQualifiedReferralsPerRider: optionalNumber(form.maxQualifiedReferralsPerRider),
    maxRewardPerRider: optionalText(form.maxRewardPerRider), campaignBudget: optionalText(form.campaignBudget),
    currency: form.currency.trim().toUpperCase(),
    milestones: form.milestones.map((milestone, index) => ({ ...milestone, sequence: index + 1 })),
  };
}
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await sessionFetch(`/api/v1/client/referrals/campaigns${path}`, {
    cache: "no-store", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const body = await response.json() as { data?: T; error?: { code?: string; message?: string }; message?: string };
  if (!response.ok || body.data === undefined) {
    const error = new Error(body.error?.message ?? body.message ?? "Unable to manage referral campaigns.") as Error & { code?: string };
    error.code = body.error?.code;
    throw error;
  }
  return body.data;
}
const dateOf = (value: string) => new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
const moneyOf = (value: string, currency: string) => `${currency} ${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
function RiderSharePreview({ form }: { form: CampaignForm }) {
  const renderedMessage = form.shareMessageTemplate.replaceAll("{{referralCode}}", sampleReferralCode).replaceAll("{{referralLink}}", sampleReferralLink);
  return <aside className="referral-live-preview" aria-label="Live mobile preview">
    <div className="referral-preview-heading"><div><p className="eyebrow">LIVE PREVIEW</p><h3>Share message and QR</h3></div><span>Sample data</span></div>
    <div className="referral-phone"><div className="referral-phone-camera" aria-hidden="true" /><div className="referral-phone-status"><span>9:41</span><span>●●● ▰</span></div>
      <div className="referral-phone-share-card"><div className="referral-phone-share-head">Referral invitation</div><div className="referral-phone-share-body"><p>{renderedMessage || "Your share message will appear here."}</p><div className="referral-share-qr"><QRCodeSVG value={sampleReferralLink} size={150} level="M" marginSize={2} /><strong>{sampleReferralCode}</strong><small>Scan to open referral link</small></div></div></div>
    </div>
    <p className="referral-preview-note">The QR image encodes the rider’s referral link. This preview uses a sample code; the rider app will share each rider’s own message and QR image.</p>
  </aside>;
}
function FieldInfo({ field, children }: { field: string; children: string }) {
  const tooltipId = useId();
  return <span className="referral-field-info"><button type="button" aria-label={`About ${field}`} aria-describedby={tooltipId}>i</button><span id={tooltipId} role="tooltip">{children}</span></span>;
}
const columns: ClientColumn<Campaign>[] = [
  { key: "campaign", label: "Campaign", value: (row) => `${row.name} ${row.code}`, render: (row) => <span className="client-legal-title"><strong>{row.name}</strong><small>{row.code}</small></span> },
  { key: "period", label: "Campaign period", value: (row) => row.startAt, render: (row) => <span>{dateOf(row.startAt)}<br />to {dateOf(row.endAt)}</span> },
  { key: "reward", label: "Rider reward", value: (row) => Number(row.referrerRewardValue), render: (row) => moneyOf(row.referrerRewardValue, row.currency) },
  { key: "status", label: "Status", value: (row) => row.status, render: (row) => <span className={`status status-${row.status.toLowerCase()}`}>{label(row.status)}</span>, filterOptions: ["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"] },
];

export function ClientReferAndEarn() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [featureDisabled, setFeatureDisabled] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CampaignForm>(emptyForm);
  const [formStep, setFormStep] = useState(0);
  const [preview, setPreview] = useState<Campaign | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const first = await api<CampaignPage>("?page=1&pageSize=100");
      const pages = Math.ceil(first.meta.total / 100);
      const more = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, index) => api<CampaignPage>(`?page=${index + 2}&pageSize=100`)));
      setCampaigns([ ...first.items, ...more.flatMap((page) => page.items) ]);
      setFeatureDisabled(false);
    } catch (cause) {
      const failure = cause as Error & { code?: string };
      if (failure.code === "REFERRAL_FEATURE_NOT_ENABLED") setFeatureDisabled(true);
      else setError(failure.message || "Unable to load referral campaigns.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  function startNew() { setEditingId(null); setForm(emptyForm()); setFormStep(0); setError(""); setNotice(""); setShowForm(true); }
  function startEdit(campaign: Campaign) { setEditingId(campaign.id); setForm(formFrom(campaign)); setFormStep(0); setError(""); setNotice(""); setShowForm(true); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formStep === 0 && new Date(form.startAt) >= new Date(form.endAt)) { setError("End date must be after start date."); return; }
    if (formStep === 1) {
      if (Number(form.referrerRewardValue) > 0 && !form.referrerRewardType) { setError("Choose a reward type for the referring rider."); return; }
      if (Number(form.refereeRewardValue) > 0 && !form.refereeRewardType) { setError("Choose a reward type for the new rider."); return; }
      if (form.campaignBudget && Number(form.campaignBudget) < Number(form.referrerRewardValue) + Number(form.refereeRewardValue)) { setError("The budget must cover at least one qualified referral."); return; }
      if (form.maxRewardPerRider && Number(form.maxRewardPerRider) < Number(form.referrerRewardValue)) { setError("Maximum reward per rider must cover the referring rider reward."); return; }
    }
    if (formStep === 2) {
      if (!form.milestones.some((item) => item.mandatory)) { setError("Add at least one required milestone."); return; }
      if (new Set(form.milestones.map((item) => item.milestoneType)).size !== form.milestones.length) { setError("Each milestone type can be used only once."); return; }
    }
    if (formStep === 3 && !/\{\{referral(Code|Link)\}\}/.test(form.shareMessageTemplate)) { setError("Include {{referralCode}} or {{referralLink}} in the share message so friends can use the referral."); return; }
    if (formStep < formSteps.length - 1) { setError(""); setFormStep((current) => current + 1); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await api(editingId ? `/${editingId}` : "", { method: editingId ? "PUT" : "POST", body: JSON.stringify(payloadOf(form)) });
      setShowForm(false); setNotice(editingId ? "Campaign draft updated." : "Campaign draft created. Activate it when ready for riders.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save campaign."); }
    finally { setBusy(false); }
  }
  async function transition(campaign: Campaign, action: "activate" | "pause" | "close" | "cancel") {
    const meaning = action === "activate" ? "Riders will be able to join during the campaign period, and rewards can be earned." : action === "close" ? "The campaign will finish and stop accepting referrals." : action === "cancel" ? "The campaign will be cancelled." : "New referrals will be paused.";
    if (!window.confirm(`${label(action)} ${campaign.name}? ${meaning}`)) return;
    setBusy(true); setError(""); setNotice("");
    try { await api(`/${campaign.id}/${action}`, { method: "POST" }); setNotice(`Campaign ${action}d.`); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update campaign."); }
    finally { setBusy(false); }
  }
  async function duplicate(campaign: Campaign) {
    const proposed = `${campaign.code}_COPY`;
    const code = window.prompt("Code for the new draft campaign (A–Z, 0–9 and _):", proposed)?.trim().toUpperCase();
    if (!code) return;
    if (!/^[A-Z0-9_]{3,48}$/.test(code)) { setError("Campaign code must be 3–48 characters: capital letters, numbers or underscores."); return; }
    setBusy(true); setError(""); setNotice("");
    try { await api(`/${campaign.id}/duplicate`, { method: "POST", body: JSON.stringify({ code }) }); setNotice("Campaign duplicated as a draft. Review its dates and rewards before activation."); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to duplicate campaign."); }
    finally { setBusy(false); }
  }
  function updateMilestone(index: number, patch: Partial<Milestone>) {
    setForm((current) => ({ ...current, milestones: current.milestones.map((item, position) => position === index ? { ...item, ...patch } : item) }));
  }

  return <div className="client-legal-documents">
    <section className="action-card client-legal-intro"><div><p className="eyebrow">RIDER REFERRALS</p><h2>Refer &amp; Earn campaigns</h2><p className="muted">Set the rider reward, eligibility milestones, dates and budget. Save a draft, then activate it for riders.</p></div>{!featureDisabled && <button type="button" onClick={startNew}>+ New campaign</button>}</section>
    {featureDisabled && <section className="action-card"><h2>Refer &amp; Earn is not enabled</h2><p className="muted">Include REFERRAL_BENEFIT in this client’s active package to create and publish campaigns.</p></section>}
    {error && !showForm && <p className="error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    {!featureDisabled && (loading ? <p className="muted">Loading campaigns…</p> : <ClientDataTable rows={campaigns} columns={columns} getRowId={(row) => row.id} emptyMessage="No referral campaigns yet. Create a draft to begin." actions={(campaign) => <>
      <button type="button" className="secondary table-action" onClick={() => setPreview(campaign)}>View</button>
      {campaign.status === "DRAFT" && <button type="button" className="secondary table-action" disabled={busy} onClick={() => startEdit(campaign)}>Edit</button>}
      {["DRAFT", "SCHEDULED", "PAUSED"].includes(campaign.status) && <button type="button" className="table-action" disabled={busy} onClick={() => void transition(campaign, "activate")}>Activate</button>}
      {campaign.status === "ACTIVE" && <button type="button" className="secondary table-action" disabled={busy} onClick={() => void transition(campaign, "pause")}>Pause</button>}
      {["ACTIVE", "PAUSED"].includes(campaign.status) && <button type="button" className="secondary table-action" disabled={busy} onClick={() => void transition(campaign, "close")}>Close</button>}
      {["DRAFT", "SCHEDULED", "PAUSED"].includes(campaign.status) && <button type="button" className="danger table-action" disabled={busy} onClick={() => void transition(campaign, "cancel")}>Cancel</button>}
      <button type="button" className="secondary table-action" disabled={busy} onClick={() => void duplicate(campaign)}>Duplicate</button>
    </>} />)}
    {showForm && <ClientFormDialog title={editingId ? "Edit referral campaign" : "Create referral campaign"} wide busy={busy} error={error} onClose={() => setShowForm(false)}>
      <div className="referral-form-heading"><div><p className="eyebrow">REFER &amp; EARN</p><h2>{editingId ? "Edit campaign draft" : "Create campaign draft"}</h2><p className="muted">Step {formStep + 1} of {formSteps.length} · {formSteps[formStep]}</p></div><button type="button" className="secondary" onClick={() => setShowForm(false)} aria-label="Close campaign form">✕</button></div>
      <ol className="referral-form-steps" aria-label="Campaign setup progress">{formSteps.map((step, index) => <li key={step} className={index === formStep ? "current" : index < formStep ? "complete" : ""} aria-current={index === formStep ? "step" : undefined}><span>{index < formStep ? "✓" : index + 1}</span>{step}</li>)}</ol>
      <form className="form-stack referral-campaign-form" onSubmit={(event) => void save(event)}>
      {formStep === 0 && <section className="form-section referral-form-panel"><p className="eyebrow">CAMPAIGN SETUP</p><h3>Campaign details</h3><p className="muted">Name the campaign and set when riders can join.</p><div className="form-grid">
        <label>Campaign name *<input required maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label>Campaign code *<input required minLength={3} maxLength={48} pattern="[A-Z0-9_]{3,48}" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} /></label>
        <label className="form-grid-full">Internal description<textarea rows={2} maxLength={1000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <label>Start date and time *<input required type="datetime-local" value={form.startAt} onChange={(event) => setForm({ ...form, startAt: event.target.value })} /></label>
        <label>End date and time *<input required type="datetime-local" value={form.endAt} onChange={(event) => setForm({ ...form, endAt: event.target.value })} /></label>
        <label>Registration window (days) *<input required type="number" min="1" step="1" value={form.registrationValidityDays} onChange={(event) => setForm({ ...form, registrationValidityDays: event.target.value })} /></label>
        <label>Qualification window (days) *<input required type="number" min="1" step="1" value={form.qualificationValidityDays} onChange={(event) => setForm({ ...form, qualificationValidityDays: event.target.value })} /></label>
      </div></section>}
      {formStep === 3 && <section className="form-section referral-form-panel"><p className="eyebrow">SHARE MESSAGE</p><h3>Message template and QR preview</h3><p className="muted">Write one message for riders to share with their personal referral code and QR image. The preview updates as you type.</p>
        <div className="referral-template-layout"><div className="referral-template-editor">
          <div className="referral-template-block"><h4>Share message</h4><label>Start from a template<select value={shareTemplates.find((item) => item.content === form.shareMessageTemplate)?.name ?? "custom"} onChange={(event) => { const selected = shareTemplates.find((item) => item.name === event.target.value); if (selected) setForm({ ...form, shareMessageTemplate: selected.content }); }}><option value="custom">Custom message</option>{shareTemplates.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label><label>Message text *<textarea required rows={7} maxLength={1000} value={form.shareMessageTemplate} onChange={(event) => setForm({ ...form, shareMessageTemplate: event.target.value })} /></label><div className="referral-template-tokens"><span>Insert:</span>{["{{referralCode}}", "{{referralLink}}"].map((token) => <button key={token} type="button" className="secondary" onClick={() => setForm((current) => ({ ...current, shareMessageTemplate: `${current.shareMessageTemplate}${current.shareMessageTemplate && !/\s$/.test(current.shareMessageTemplate) ? " " : ""}${token}`.slice(0, 1000) }))}>{token}</button>)}</div><p className="muted">These tokens become the rider’s unique code and link. Use at least one.</p></div>
          <p className="muted">The published Rider Terms &amp; Conditions are used for every rider. There are no campaign-specific terms to enter here.</p>
        </div><RiderSharePreview form={form} /></div>
      </section>}
      {formStep === 1 && <section className="form-section referral-form-panel"><p className="eyebrow">REWARD RULES</p><h3>Rewards and limits</h3><p className="muted">Set what each rider earns after a referral qualifies.</p>
        <div className="referral-reward-cards">
          <div className="referral-reward-card"><strong>Referring rider</strong><p className="muted">The rider who shares their referral code.</p><label>Reward type<select value={form.referrerRewardType} onChange={(event) => setForm({ ...form, referrerRewardType: event.target.value })}><option value="">No reward</option>{rewardTypes.map((type) => <option key={type} value={type}>{label(type)}</option>)}</select></label><label>Reward value *<input required type="number" min="0" step="0.01" value={form.referrerRewardValue} onChange={(event) => setForm({ ...form, referrerRewardValue: event.target.value })} /></label></div>
          <div className="referral-reward-card"><strong>New rider</strong><p className="muted">The rider who signs up using the code.</p><label>Reward type<select value={form.refereeRewardType} onChange={(event) => setForm({ ...form, refereeRewardType: event.target.value })}><option value="">No reward</option>{rewardTypes.map((type) => <option key={type} value={type}>{label(type)}</option>)}</select></label><label>Reward value *<input required type="number" min="0" step="0.01" value={form.refereeRewardValue} onChange={(event) => setForm({ ...form, refereeRewardValue: event.target.value })} /></label></div>
        </div>
        <div className="form-grid"><label>Currency *<input required pattern="[A-Z]{3}" maxLength={3} value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} /></label><label>Campaign budget<input type="number" min="0" step="0.01" value={form.campaignBudget} onChange={(event) => setForm({ ...form, campaignBudget: event.target.value })} /></label></div>
        <details className="referral-advanced"><summary>Advanced limits <span>Optional per-rider controls</span></summary><div className="form-grid">
          <label><span className="referral-field-label">Maximum referrals per rider <FieldInfo field="Maximum referrals per rider">The most referrals one rider can submit for this campaign. Rejected, cancelled and expired referrals do not count. Leave blank for no limit.</FieldInfo></span><input type="number" min="1" step="1" value={form.maxReferralsPerRider} onChange={(event) => setForm({ ...form, maxReferralsPerRider: event.target.value })} /></label>
          <label><span className="referral-field-label">Referral limit period <FieldInfo field="Referral limit period">Choose whether the maximum referrals per rider applies across the whole campaign or resets at the start of each calendar month. This does not reset reward or qualified referral limits.</FieldInfo></span><select value={form.referralLimitPeriod} onChange={(event) => setForm({ ...form, referralLimitPeriod: event.target.value })}><option value="LIFETIME">Lifetime</option><option value="MONTHLY">Monthly</option></select></label>
          <label><span className="referral-field-label">Maximum qualified referrals per rider <FieldInfo field="Maximum qualified referrals per rider">The most referrals from one referring rider that can meet the milestones and earn rewards in this campaign. Leave blank for no limit.</FieldInfo></span><input type="number" min="1" step="1" value={form.maxQualifiedReferralsPerRider} onChange={(event) => setForm({ ...form, maxQualifiedReferralsPerRider: event.target.value })} /></label>
          <label><span className="referral-field-label">Maximum reward per rider <FieldInfo field="Maximum reward per rider">The total reward value one referring rider can earn in this campaign. Rewards paid to new riders are not included. Leave blank for no limit.</FieldInfo></span><input type="number" min="0" step="0.01" value={form.maxRewardPerRider} onChange={(event) => setForm({ ...form, maxRewardPerRider: event.target.value })} /></label>
        </div></details>
      </section>}
      {formStep === 2 && <section className="form-section referral-form-panel"><p className="eyebrow">ELIGIBILITY</p><h3>Qualification milestones</h3><p className="muted">A referral qualifies after its required milestones are met. Use target 1 for one-time events.</p>{form.milestones.map((milestone, index) => <div className="form-grid referral-milestone" key={index}>
        <div className="referral-milestone-title"><strong>Milestone {index + 1}</strong>{form.milestones.length > 1 && <button className="secondary" type="button" onClick={() => setForm((current) => ({ ...current, milestones: current.milestones.filter((_, position) => position !== index) }))}>Remove</button>}</div>
        <label>Milestone *<select value={milestone.milestoneType} onChange={(event) => updateMilestone(index, { milestoneType: event.target.value, targetValue: oneTimeMilestones.includes(event.target.value) ? "1" : milestone.targetValue })}>{milestoneTypes.map((type) => <option key={type} value={type}>{label(type)}</option>)}</select></label>
        <label>Comparison *<select value={milestone.operator} onChange={(event) => updateMilestone(index, { operator: event.target.value })}>{["GTE", "EQ", "GT", "LTE", "LT"].map((operator) => <option key={operator} value={operator}>{operator === "GTE" ? "At least" : operator === "EQ" ? "Exactly" : operator === "GT" ? "More than" : operator === "LTE" ? "At most" : "Less than"}</option>)}</select></label>
        <label>Target *<input required type="number" min="0.0001" step="any" readOnly={oneTimeMilestones.includes(milestone.milestoneType)} value={milestone.targetValue} onChange={(event) => updateMilestone(index, { targetValue: event.target.value })} /></label>
        <label className="referral-milestone-check"><input type="checkbox" checked={milestone.mandatory} onChange={(event) => updateMilestone(index, { mandatory: event.target.checked })} /> Required to qualify</label>
      </div>)}<button className="secondary" type="button" disabled={form.milestones.length >= milestoneTypes.length} onClick={() => setForm((current) => ({ ...current, milestones: [...current.milestones, { milestoneType: milestoneTypes.find((type) => !current.milestones.some((item) => item.milestoneType === type)) ?? "ACTIVE_DAYS", operator: "GTE", targetValue: "1", sequence: current.milestones.length + 1, mandatory: true }] }))}>+ Add milestone</button></section>}
      {formStep === 3 && <aside className="referral-form-review"><strong>Campaign summary</strong><span>{form.name || "Untitled campaign"} · {dateOf(new Date(form.startAt).toISOString())} – {dateOf(new Date(form.endAt).toISOString())}</span><span>Referring rider: {moneyOf(form.referrerRewardValue, form.currency)} · New rider: {moneyOf(form.refereeRewardValue, form.currency)} · {form.milestones.filter((item) => item.mandatory).length} required milestone(s)</span></aside>}
      <div className="referral-form-footer"><button type="button" className="secondary" disabled={formStep === 0 || busy} onClick={() => { setError(""); setFormStep((current) => current - 1); }}>Back</button><span className="muted">Campaign rules can be edited while this is a draft.</span><button type="submit" disabled={busy}>{busy ? "Saving…" : formStep === formSteps.length - 1 ? "Save draft" : "Continue"}</button></div>
    </form></ClientFormDialog>}
    {preview && <ClientFormDialog title={`View ${preview.name}`} wide onClose={() => setPreview(null)}><p className="eyebrow">{preview.code} · {label(preview.status)}</p><h2>{preview.name}</h2><p>{preview.description || "No description."}</p><div className="form-grid"><p><strong>Period</strong><br />{dateOf(preview.startAt)} to {dateOf(preview.endAt)}</p><p><strong>Referring rider reward</strong><br />{moneyOf(preview.referrerRewardValue, preview.currency)} ({label(preview.referrerRewardType || "NONE")})</p><p><strong>New rider reward</strong><br />{moneyOf(preview.refereeRewardValue, preview.currency)} ({label(preview.refereeRewardType || "NONE")})</p><p><strong>Campaign budget</strong><br />{preview.campaignBudget ? moneyOf(preview.campaignBudget, preview.currency) : "No limit"}</p></div><h3>Qualification</h3><ul>{preview.milestones.map((item) => <li key={item.id}>{label(item.milestoneType)} · {item.operator} {item.targetValue}{item.mandatory ? " · Required" : " · Optional"}</li>)}</ul><h3>Share message</h3><p className="referral-terms-preview">{preview.shareMessageTemplate || shareTemplates[0].content}</p><div className="form-actions"><button type="button" className="secondary" onClick={() => setPreview(null)}>Close</button></div></ClientFormDialog>}
  </div>;
}

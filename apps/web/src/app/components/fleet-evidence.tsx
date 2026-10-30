"use client";

import { useEffect, useRef, useState } from "react";
import { sessionFetch } from "../../lib/session-fetch";
import { formatDateTime } from "../../lib/presentation";
import { ClientFormDialog } from "./client-form-dialog";
import { markFormsSaved } from "./unsaved-changes";
import { ClientDataTable } from "./client-data-table";

type Request = (path: string, options?: RequestInit) => Promise<unknown>;
type Photo = { id: string; workFlowType: string; subjectType: string; photoType: string; entityId: string; mimeType: string; uploadedAt: string | null; createdAt: string };
type Group = { id: string; category: string; label: string; date: string | null; photos: Photo[] };
type Requirement = { id: string; photoType: string; isRequired: boolean; sortOrder: number };
const label = (value: string) => value.replaceAll("_", " ");
const categories = ["All", "Fleet & components", "Installation", "Preparation & QC", "Allocation", "Submission"];
const photoTypes = ["FRONT", "BACK", "LEFT", "RIGHT", "REAR", "BODY", "LABEL", "CHASSIS", "DASHBOARD", "INSTALLATION", "EVIDENCE", "DOCUMENT", "PROFILE", "RECEIPT", "RETURN_CHECKLIST", "DAMAGE", "DAMAGE_CLOSEUP", "VEHICLE_FRONT", "VEHICLE_LEFT", "VEHICLE_RIGHT", "VEHICLE_REAR", "FLEET_FRONT", "FLEET_LEFT", "FLEET_RIGHT", "FLEET_BACK", "BATTERY_BODY", "BATTERY_LABEL", "CONTROLLER_BODY", "CONTROLLER_LABEL", "IOT_BODY", "IOT_LABEL", "FLEET_WITH_RIDER", "RIDER_DECLARATION", "PDI_VOICE", "PAYMENT_RECEIPT", "PENALTY_DAMAGE", "OTHER"];
const subjects = [
  ["FLEET_INSPECTION", "FLEET", "Fleet"], ["FLEET_INSPECTION", "BATTERY", "Battery"],
  ["FLEET_INSPECTION", "CONTROLLER", "Controller"], ["FLEET_INSPECTION", "IOT_DEVICE", "IoT"], ["FLEET_INSPECTION", "MOTOR", "Motor"], ["FLEET_INSPECTION", "TYRE", "Tyre"], ["FLEET_INSPECTION", "DOCK", "Dock"],
  ["FLEET_PREPARATION", "FLEET", "Preparation"], ["FLEET_PREPARATION", "OTHER", "Installation"],
  ["FLEET_ALLOTMENT", "FLEET", "Allocation inspection"], ["FLEET_SUBMISSION", "FLEET", "Submission inspection"],
  ["RIDER_ONBOARDING", "PROFILE", "Rider profile"], ["RIDER_ONBOARDING", "PAN", "PAN"],
  ["RIDER_ONBOARDING", "AADHAR", "Aadhaar"], ["RIDER_ONBOARDING", "DRIVING_LICENSE", "Driving license"], ["RIDER_ONBOARDING", "BANK", "Bank document"], ["RIDER_ONBOARDING", "DECLARATION", "Rider document"], ["PAYMENT", "ONBOARDING_FEES", "Onboarding fees"],
];

function PhotoRequirements({ request, canEdit, onBusy }: { request: Request; canEdit: boolean; onBusy: (value: boolean) => void }) {
  const [subjectKey, setSubjectKey] = useState("FLEET_INSPECTION:FLEET");
  const [workFlowType, subjectType] = subjectKey.split(":");
  const [rows, setRows] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [type, setType] = useState(""), [required, setRequired] = useState(true);
  const ref = useRef(request);
  useEffect(() => { ref.current = request; }, [request]);
  useEffect(() => {
    let active = true;
    void ref.current(`/media/photo-requirements?workFlowType=${workFlowType}&subjectType=${subjectType}`).then(data => { if (active) setRows(data as Requirement[]); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load requirements."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workFlowType, subjectType]);
  async function save(photoType: string, isRequired: boolean, sortOrder: number) {
    setSaving(true); onBusy(true); setError("");
    try {
      const row = await request(`/media/photo-requirements/${workFlowType}/${subjectType}/${photoType}`, { method: "PUT", body: JSON.stringify({ isRequired, sortOrder }) }) as Requirement;
      setRows(current => current.some(item => item.photoType === photoType) ? current.map(item => item.photoType === photoType ? row : item) : [...current, row]);
      setType(""); setRequired(true); markFormsSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save requirement."); }
    finally { setSaving(false); onBusy(false); }
  }
  return <>
    <p className="muted">These are client-wide photo requirements, shared by all scooters. Allocation and submission use the existing inspection requirements. Operating mode and workflow checks remain unchanged.</p>
    <label>Photo requirements for<select value={subjectKey} disabled={saving} onChange={event => { setLoading(true); setRows([]); setError(""); setType(""); setSubjectKey(event.target.value); }}>{subjects.map(([workflow, subject, name]) => <option key={`${workflow}:${subject}`} value={`${workflow}:${subject}`}>{name} · {label(workflow)}</option>)}</select></label>
    {error && <p className="error" role="alert">{error}</p>}
    <ClientDataTable rows={rows} loading={loading} getRowId={row => row.id} emptyMessage="No photo types configured." columns={[
      { key: "type", label: "Photo type", value: row => label(row.photoType) },
      { key: "required", label: "Required", value: row => row.isRequired ? "Required" : "Optional", render: row => canEdit ? <input type="checkbox" checked={row.isRequired} disabled={saving || loading} aria-label={`Require ${label(row.photoType)}`} onChange={event => void save(row.photoType, event.target.checked, row.sortOrder)} /> : row.isRequired ? "Required" : "Optional" },
      { key: "order", label: "Order", value: row => row.sortOrder },
    ]} />
    {canEdit && <form className="form-stack" onSubmit={event => { event.preventDefault(); void save(type.trim().toUpperCase(), required, rows.length); }}>
      <h3>Configure photo type</h3>
      <label>Photo type<select required value={type} onChange={event => setType(event.target.value)} disabled={saving || loading}><option value="">Choose a supported photo type</option>{photoTypes.filter(value => !rows.some(row => row.photoType === value)).map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>
      <label><input type="checkbox" checked={required} onChange={event => setRequired(event.target.checked)} disabled={saving || loading} /> Required for completion</label>
      <div className="form-actions"><button disabled={saving || loading || !type}>Add selected type</button></div>
    </form>}
  </>;
}

export function FleetEvidenceDialog({ fleet, request, canEditRequirements, onClose }: { fleet: { id: string; name: string }; request: Request; canEditRequirements: boolean; onClose: () => void }) {
  const [groups, setGroups] = useState<Group[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [settings, setSettings] = useState(false), [category, setCategory] = useState("All"), [retry, setRetry] = useState(0);
  const [preview, setPreview] = useState<{ url: string; photo: Photo } | null>(null), [opening, setOpening] = useState(false);
  const [savingRequirements, setSavingRequirements] = useState(false);
  const ref = useRef(request);
  const mounted = useRef(true);
  useEffect(() => { ref.current = request; }, [request]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    void ref.current(`/media/fleets/${fleet.id}/evidence`).then(data => { if (active) setGroups(data as Group[]); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load fleet evidence."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fleet.id, retry]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  async function open(photo: Photo) {
    setOpening(true); setError("");
    try {
      const response = await sessionFetch(`/api/v1/media/fleets/${fleet.id}/evidence/${photo.id}/content`);
      if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error?.message ?? body?.message ?? "Unable to load evidence file."); }
      const mime = response.headers.get("content-type")?.split(";")[0];
      if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(mime ?? "")) throw new Error("Unsupported evidence file type.");
      const blob = await response.blob();
      if (mounted.current) setPreview({ url: URL.createObjectURL(blob), photo: { ...photo, mimeType: mime! } });
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "Unable to load evidence file."); }
    finally { if (mounted.current) setOpening(false); }
  }
  const rows = groups.filter(group => category === "All" || group.category === category).flatMap(group => group.photos.map(photo => ({ ...photo, group: photo.entityId.startsWith("installation:") ? `${group.label} · revision ${photo.entityId.split(":").at(-1)}` : group.label, category: group.category, groupDate: group.date })));
  return <>
    <ClientFormDialog title={`Photos & Evidence · ${fleet.name}`} wide formsOnly busy={opening || savingRequirements} error={error} onClose={onClose}>
      <div className="client-dialog-view-switcher">
        <button type="button" className={settings ? "secondary" : ""} disabled={savingRequirements} aria-pressed={!settings} onClick={() => setSettings(false)}>Photos & history</button>
        <button type="button" className={settings ? "" : "secondary"} disabled={savingRequirements} aria-pressed={settings} onClick={() => setSettings(true)}>Photo requirements</button>
      </div>
      {settings ? <PhotoRequirements request={request} canEdit={canEditRequirements} onBusy={setSavingRequirements} /> : <>
        <p className="muted">Uploaded evidence for this scooter, grouped by workflow. Uploads and approvals remain in their existing onboarding, installation, preparation, allocation and submission workflows.</p>
        <div className="client-filter-bar"><label>Workflow<select value={category} onChange={event => setCategory(event.target.value)}>{categories.map(value => <option key={value}>{value}</option>)}</select></label><button type="button" className="secondary" disabled={loading} onClick={() => { setLoading(true); setError(""); setRetry(value => value + 1); }}>Refresh</button></div>
        <ClientDataTable rows={rows} loading={loading} getRowId={row => `${row.group}:${row.id}`} emptyMessage="No uploaded evidence for this selection." columns={[
          { key: "category", label: "Workflow", value: row => row.category },
          { key: "group", label: "Record", value: row => row.group },
          { key: "date", label: "Record date", value: row => row.groupDate ?? "", render: row => row.groupDate ? formatDateTime(row.groupDate) : "—" },
          { key: "type", label: "Photo type", value: row => label(row.photoType) },
          { key: "uploaded", label: "Uploaded", value: row => row.uploadedAt ?? row.createdAt, render: row => formatDateTime(row.uploadedAt ?? row.createdAt) },
        ]} actions={photo => <button type="button" className="secondary table-action" disabled={opening} onClick={() => void open(photo)}>View</button>} />
      </>}
    </ClientFormDialog>
    {preview && <ClientFormDialog title={label(preview.photo.photoType)} wide formsOnly onClose={() => setPreview(null)}>
      {preview.photo.mimeType === "application/pdf" ? <iframe src={preview.url} title="Evidence document" style={{ width: "100%", height: "65vh", border: 0 }} /> : <img src={preview.url} alt={label(preview.photo.photoType)} style={{ display: "block", maxWidth: "100%", maxHeight: "65vh", objectFit: "contain", margin: "auto" }} />}
      <div className="form-actions"><a className="button secondary" href={preview.url} download={`fleet-evidence-${preview.photo.id}.${preview.photo.mimeType === "application/pdf" ? "pdf" : preview.photo.mimeType.split("/")[1]}`}>Download</a><button type="button" className="secondary" onClick={() => setPreview(null)}>Close preview</button></div>
    </ClientFormDialog>}
  </>;
}

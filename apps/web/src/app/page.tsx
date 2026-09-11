"use client";

import { FormEvent, useEffect, useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api/v1";
type Tab = "dashboard" | "fleets" | "riders" | "allocations";
type RecordItem = Record<string, unknown>;

interface Dashboard {
  fleet: Record<string, number>;
  riders: Record<string, number>;
  activeAllocations: number;
  iot: { online: number; offline: number };
}

async function request(
  path: string,
  options: RequestInit = {},
  token?: string,
) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as {
    data?: unknown;
    message?: string;
  };
  if (!response.ok)
    throw new Error(body.message ?? "Request failed. Please try again.");
  return body.data;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Status({ value }: { value: string }) {
  return (
    <span
      className={`status status-${value.toLowerCase().replaceAll("_", "-")}`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}

export default function Home() {
  const [phone, setPhone] = useState("");
  const [tenantSlug, setTenantSlug] = useState("demo-tenant");
  const [otpRequestId, setOtpRequestId] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [items, setItems] = useState<RecordItem[]>([]);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ page: 1, pageSize: 20, total: 0 });
  const [availableFleets, setAvailableFleets] = useState<RecordItem[]>([]);
  const [activeRiders, setActiveRiders] = useState<RecordItem[]>([]);
  const [allocationFleetId, setAllocationFleetId] = useState("");
  const [allocationRiderId, setAllocationRiderId] = useState("");
  const [showAllocationForm, setShowAllocationForm] = useState(false);
  const [showRiderForm, setShowRiderForm] = useState(false);
  const [newRiderName, setNewRiderName] = useState("");
  const [newRiderMobile, setNewRiderMobile] = useState("");
  const [inspectionId, setInspectionId] = useState("");
  const [inspectionType, setInspectionType] = useState("PRE_ALLOCATION");
  const [requirements, setRequirements] = useState<RecordItem[]>([]);
  const [uploadedPhotoTypes, setUploadedPhotoTypes] = useState<string[]>([]);
  const [deallocationId, setDeallocationId] = useState("");
  const [riderPhone, setRiderPhone] = useState("");
  const [operatorPhone, setOperatorPhone] = useState("");
  const [otpRequests, setOtpRequests] = useState<Record<string, string>>({});
  const [otpCodes, setOtpCodes] = useState<Record<string, string>>({});
  const [verifiedParties, setVerifiedParties] = useState<string[]>([]);
  const [allocationDetail, setAllocationDetail] = useState<RecordItem | null>(
    null,
  );
  const [vehicleState, setVehicleState] = useState<RecordItem | null>(null);
  const [riderDetail, setRiderDetail] = useState<RecordItem | null>(null);
  const [fleetDetail, setFleetDetail] = useState<RecordItem | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = sessionStorage.getItem("evs-eye-access-token");
    if (!saved) return;
    const timer = window.setTimeout(() => setToken(saved), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!token) return;
    void loadView(tab);
    // Loading belongs to the selected view and intentionally runs after sign-in/tab change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tab, page]);

  async function loadView(nextTab: Tab) {
    setLoading(true);
    setError("");
    try {
      if (nextTab === "dashboard")
        setDashboard((await request("/dashboard", {}, token)) as Dashboard);
      else {
        const query = new URLSearchParams({
          page: String(page),
          pageSize: "20",
        });
        if (search) query.set("search", search);
        if (statusFilter) query.set("status", statusFilter);
        const result = (await request(
          `/${nextTab}?${query.toString()}`,
          {},
          token,
        )) as {
          items: RecordItem[];
          meta: { page: number; pageSize: number; total: number };
        };
        setItems(result.items);
        setMeta(result.meta);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load data.");
    } finally {
      setLoading(false);
    }
  }

  async function sendOtp(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = (await request("/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ phone, tenantSlug }),
      })) as { otpRequestId: string };
      setOtpRequestId(data.otpRequestId);
      setNotice("OTP sent. Enter the six-digit code to continue.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to request OTP.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = (await request("/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify({ otpRequestId, code }),
      })) as { accessToken: string };
      sessionStorage.setItem("evs-eye-access-token", data.accessToken);
      setToken(data.accessToken);
      setNotice("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to verify OTP.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function openAllocationForm() {
    setLoading(true);
    setError("");
    try {
      const [fleets, riders] = await Promise.all([
        request(
          "/fleets?status=AVAILABLE&page=1&pageSize=100",
          {},
          token,
        ) as Promise<{ items: RecordItem[] }>,
        request(
          "/riders?status=ACTIVE&page=1&pageSize=100",
          {},
          token,
        ) as Promise<{ items: RecordItem[] }>,
      ]);
      setAvailableFleets(fleets.items);
      setActiveRiders(riders.items);
      setShowAllocationForm(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load allocation options.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function createRider(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try { await request("/riders", { method: "POST", body: JSON.stringify({ name: newRiderName, mobile: newRiderMobile }) }, token); setShowRiderForm(false); setNewRiderName(""); setNewRiderMobile(""); setNotice("Rider created. Add a profile photo and start KYC from rider detail."); await loadView("riders"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create rider."); }
    finally { setLoading(false); }
  }

  async function createAllocation(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const allocation = (await request(
        "/allocations",
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({
            fleetId: allocationFleetId,
            riderId: allocationRiderId,
          }),
        },
        token,
      )) as { id: string };
      setShowAllocationForm(false);
      setAllocationFleetId("");
      setAllocationRiderId("");
      setTab("allocations");
      setNotice(
        `Allocation ${allocation.id.slice(0, 8)} created. Complete its pre-allocation inspection before activation.`,
      );
      await loadView("allocations");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to create allocation.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function openInspection(allocation: RecordItem) {
    const targetType =
      allocation.status === "DEALLOCATION_INITIATED"
        ? "POST_DEALLOCATION"
        : "PRE_ALLOCATION";
    const inspection = (
      (allocation.inspections as RecordItem[] | undefined) ?? []
    ).find((item) => item.type === targetType);
    if (!inspection?.id)
      return setError(
        `This allocation has no ${targetType.toLowerCase().replaceAll("_", " ")} inspection.`,
      );
    setLoading(true);
    setError("");
    try {
      const [details, photoRequirements] = await Promise.all([
        request(`/inspections/${String(inspection.id)}`, {}, token) as Promise<{
          photos: RecordItem[];
        }>,
        request(
          "/media/photo-requirements?entityType=INSPECTION",
          {},
          token,
        ) as Promise<RecordItem[]>,
      ]);
      setInspectionId(String(inspection.id));
      setInspectionType(targetType);
      setRequirements(photoRequirements);
      setUploadedPhotoTypes(
        details.photos
          .filter((photo) => photo.status === "COMPLETE")
          .map((photo) => String(photo.photoType)),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to open inspection.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function uploadInspectionPhoto(
    photoType: string,
    file: File | undefined,
  ) {
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError("Use a JPG, PNG, or WebP image no larger than 5 MB.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const intent = (await request(
        "/media/upload-intents",
        {
          method: "POST",
          body: JSON.stringify({
            entityType: "INSPECTION",
            entityId: inspectionId,
            photoType,
            mimeType: file.type,
            fileName: file.name,
            sizeBytes: file.size,
          }),
        },
        token,
      )) as { photo: { id: string }; uploadUrl: string };
      const upload = await fetch(intent.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!upload.ok)
        throw new Error("Object storage rejected the file upload.");
      await request(
        `/media/${intent.photo.id}/complete`,
        { method: "POST" },
        token,
      );
      setUploadedPhotoTypes((current) => [...new Set([...current, photoType])]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to upload inspection photo.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function completeInspection() {
    setLoading(true);
    setError("");
    try {
      await request(
        `/inspections/${inspectionId}/complete`,
        { method: "POST" },
        token,
      );
      setNotice(
        inspectionType === "POST_DEALLOCATION"
          ? "Post-deallocation inspection completed. Verify both OTPs to finish."
          : "Inspection completed. The allocation is ready for activation.",
      );
      setInspectionId("");
      await loadView("allocations");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Inspection cannot be completed yet.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function activateAllocation(allocationId: string) {
    setLoading(true);
    setError("");
    try {
      await request(
        `/allocations/${allocationId}/activate`,
        { method: "POST" },
        token,
      );
      setNotice("Allocation activated and fleet marked as allocated.");
      await loadView("allocations");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Allocation cannot be activated.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function openAllocationDetail(allocationId: string) {
    setLoading(true);
    setError("");
    try {
      const detail = (await request(
        `/allocations/${allocationId}`,
        {},
        token,
      )) as RecordItem;
      setAllocationDetail(detail);
      const fleet = detail.fleet as RecordItem;
      setVehicleState(
        (await request(
          `/fleets/${String(fleet.id)}/current-state`,
          {},
          token,
        )) as RecordItem | null,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load allocation details.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function openRiderDetail(riderId: string) {
    setLoading(true);
    setError("");
    try {
      setRiderDetail(
        (await request(`/riders/${riderId}`, {}, token)) as RecordItem,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load rider details.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function openFleetDetail(fleetId: string) {
    setLoading(true); setError("");
    try { setFleetDetail(await request(`/fleets/${fleetId}`, {}, token) as RecordItem); setVehicleState(await request(`/fleets/${fleetId}/current-state`, {}, token) as RecordItem | null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load fleet details."); }
    finally { setLoading(false); }
  }

  async function initiateDeallocation(allocation: RecordItem) {
    const allocationId = String(allocation.id);
    setLoading(true);
    setError("");
    try {
      await request(
        `/allocations/${allocationId}/deallocation/initiate`,
        { method: "POST" },
        token,
      );
      setDeallocationId(allocationId);
      setRiderPhone(String((allocation.rider as RecordItem)?.mobile ?? ""));
      setOtpRequests({});
      setOtpCodes({});
      setVerifiedParties([]);
      setNotice(
        "Deallocation started. Capture post-deallocation inspection evidence, then verify both OTPs.",
      );
      await loadView("allocations");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to start deallocation.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function requestDeallocationOtp(party: "RIDER" | "OPERATOR") {
    const phone = party === "RIDER" ? riderPhone : operatorPhone;
    setLoading(true);
    setError("");
    try {
      const data = (await request(
        `/allocations/${deallocationId}/deallocation/otp/request`,
        { method: "POST", body: JSON.stringify({ party, phone }) },
        token,
      )) as { otpRequestId: string };
      setOtpRequests((current) => ({ ...current, [party]: data.otpRequestId }));
      setNotice(`${party === "RIDER" ? "Rider" : "Operator"} OTP sent.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to send OTP.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyDeallocationOtp(party: "RIDER" | "OPERATOR") {
    setLoading(true);
    setError("");
    try {
      await request(
        `/allocations/${deallocationId}/deallocation/otp/verify`,
        {
          method: "POST",
          body: JSON.stringify({
            otpRequestId: otpRequests[party],
            code: otpCodes[party],
          }),
        },
        token,
      );
      setVerifiedParties((current) => [...new Set([...current, party])]);
      setNotice(`${party === "RIDER" ? "Rider" : "Operator"} OTP verified.`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "OTP verification failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function completeDeallocation() {
    setLoading(true);
    setError("");
    try {
      await request(
        `/allocations/${deallocationId}/deallocation/complete`,
        { method: "POST" },
        token,
      );
      setNotice("Deallocation completed and fleet returned to available.");
      setDeallocationId("");
      await loadView("allocations");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Deallocation cannot be completed yet.",
      );
    } finally {
      setLoading(false);
    }
  }

  function signOut() {
    sessionStorage.removeItem("evs-eye-access-token");
    setToken("");
    setOtpRequestId("");
    setCode("");
    setDashboard(null);
    setItems([]);
  }

  if (!token)
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="eyebrow">EVS EYE · OPERATIONS</p>
          <h1>Fleet control, clearly seen.</h1>
          <p className="muted">
            Use your operations mobile number to enter the tenant workspace.
          </p>
          {!otpRequestId ? (
            <form onSubmit={sendOtp} className="form-stack">
              <label>
                Tenant slug
                <input
                  value={tenantSlug}
                  onChange={(e) => setTenantSlug(e.target.value)}
                  required
                />
              </label>
              <label>
                Mobile number
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+919999999999"
                  required
                />
              </label>
              <button disabled={loading}>
                {loading ? "Sending…" : "Send OTP"}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyOtp} className="form-stack">
              <label>
                Six-digit OTP
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                />
              </label>
              <button disabled={loading}>
                {loading ? "Verifying…" : "Verify and enter"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setOtpRequestId("")}
              >
                Use another number
              </button>
            </form>
          )}
          {notice && <p className="notice">{notice}</p>}
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );

  const title = tab[0].toUpperCase() + tab.slice(1);
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">EVS EYE</p>
          <h2>Operations</h2>
        </div>
        <nav>
          {(["dashboard", "fleets", "riders", "allocations"] as Tab[]).map(
            (item) => (
              <button
                key={item}
                className={tab === item ? "nav-active" : ""}
                onClick={() => setTab(item)}
              >
                {item}
              </button>
            ),
          )}
        </nav>
        <button className="sign-out" onClick={signOut}>
          Sign out
        </button>
      </aside>
      <section className="workspace">
        <header>
          <div>
            <p className="eyebrow">TENANT WORKSPACE</p>
            <h1>{title}</h1>
          </div>
          <div className="header-actions">
            {tab === "allocations" && (
              <button onClick={() => void openAllocationForm()}>
                New allocation
              </button>
            )}
            <button className="secondary" onClick={() => void loadView(tab)}>
              Refresh
            </button>
          </div>
        </header>
        {tab !== "dashboard" && (
          <form
            className="list-filters"
            onSubmit={(event) => {
              event.preventDefault();
              void loadView(tab);
            }}
          >
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={
                tab === "fleets"
                  ? "Search vehicle, chassis, OEM"
                  : tab === "riders"
                    ? "Search rider or mobile"
                    : "Filter by fleet or rider ID"
              }
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">All statuses</option>
              {(tab === "fleets"
                ? ["AVAILABLE", "ALLOCATED", "MAINTENANCE", "OFFLINE"]
                : tab === "riders"
                  ? ["ACTIVE", "PENDING", "BLOCKED"]
                  : [
                      "INSPECTION_PENDING",
                      "OTP_PENDING",
                      "ACTIVE",
                      "DEALLOCATION_INITIATED",
                      "COMPLETED",
                    ]
              ).map((status) => (
                <option key={status} value={status}>
                  {status.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <button>Apply</button>
          </form>
        )}
        {notice && <p className="notice">{notice}</p>}
        {error && <p className="error">{error}</p>}
        {loading && <p className="muted">Loading current data…</p>}
        {showAllocationForm && (
          <section className="action-card">
            <div>
              <p className="eyebrow">ALLOCATION</p>
              <h2>Assign an available vehicle</h2>
              <p className="muted">
                This reserves the fleet and creates its pre-allocation
                inspection.
              </p>
            </div>
            <form className="form-stack" onSubmit={createAllocation}>
              <label>
                Available fleet
                <select
                  value={allocationFleetId}
                  onChange={(e) => setAllocationFleetId(e.target.value)}
                  required
                >
                  <option value="">Select fleet</option>
                  {availableFleets.map((fleet) => (
                    <option key={String(fleet.id)} value={String(fleet.id)}>
                      {String(fleet.vehicleNumber)} ·{" "}
                      {String(fleet.oem ?? "Vehicle")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Active rider
                <select
                  value={allocationRiderId}
                  onChange={(e) => setAllocationRiderId(e.target.value)}
                  required
                >
                  <option value="">Select rider</option>
                  {activeRiders.map((rider) => (
                    <option key={String(rider.id)} value={String(rider.id)}>
                      {String(rider.name)} · {String(rider.mobile)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-actions">
                <button type="submit" disabled={loading}>
                  Create allocation
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowAllocationForm(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        )}
        {inspectionId && (
          <section className="action-card">
            <div>
              <p className="eyebrow">
                {inspectionType.replaceAll("_", " ")} INSPECTION
              </p>
              <h2>Required photo evidence</h2>
              <p className="muted">
                Each required slot must be complete before this workflow can
                proceed.
              </p>
            </div>
            <div className="photo-slots">
              {requirements.map((requirement) => {
                const photoType = String(requirement.photoType);
                const complete = uploadedPhotoTypes.includes(photoType);
                return (
                  <label
                    key={photoType}
                    className={complete ? "photo-slot complete" : "photo-slot"}
                  >
                    <span>
                      {complete ? "✓" : "○"} {photoType.replaceAll("_", " ")}
                      {requirement.isRequired ? " · required" : " · optional"}
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={loading}
                      onChange={(event) =>
                        void uploadInspectionPhoto(
                          photoType,
                          event.target.files?.[0],
                        )
                      }
                    />
                  </label>
                );
              })}
            </div>
            <div className="form-actions">
              <button
                disabled={loading}
                onClick={() => void completeInspection()}
              >
                Complete inspection
              </button>
              <button className="secondary" onClick={() => setInspectionId("")}>
                Close
              </button>
            </div>
          </section>
        )}
        {deallocationId && (
          <section className="action-card">
            <div>
              <p className="eyebrow">DEALLOCATION SECURITY</p>
              <h2>Verify rider and operator</h2>
              <p className="muted">
                Both separately delivered OTPs are required before completion.
              </p>
            </div>
            {(["RIDER", "OPERATOR"] as const).map((party) => (
              <div className="otp-row" key={party}>
                <label>
                  {party === "RIDER" ? "Rider mobile" : "Operator mobile"}
                  <input
                    value={party === "RIDER" ? riderPhone : operatorPhone}
                    onChange={(event) =>
                      party === "RIDER"
                        ? setRiderPhone(event.target.value)
                        : setOperatorPhone(event.target.value)
                    }
                  />
                </label>
                {!otpRequests[party] ? (
                  <button
                    disabled={loading}
                    onClick={() => void requestDeallocationOtp(party)}
                  >
                    Send OTP
                  </button>
                ) : verifiedParties.includes(party) ? (
                  <span className="status">Verified</span>
                ) : (
                  <>
                    <input
                      className="otp-code"
                      value={otpCodes[party] ?? ""}
                      onChange={(event) =>
                        setOtpCodes((current) => ({
                          ...current,
                          [party]: event.target.value,
                        }))
                      }
                      placeholder="6-digit OTP"
                      maxLength={6}
                    />
                    <button
                      disabled={loading}
                      onClick={() => void verifyDeallocationOtp(party)}
                    >
                      Verify
                    </button>
                  </>
                )}
              </div>
            ))}
            <div className="form-actions">
              <button
                disabled={loading || verifiedParties.length !== 2}
                onClick={() => void completeDeallocation()}
              >
                Complete deallocation
              </button>
              <button
                className="secondary"
                onClick={() => setDeallocationId("")}
              >
                Close
              </button>
            </div>
          </section>
        )}
        {allocationDetail && (
          <section className="action-card detail-card">
            <div>
              <p className="eyebrow">ALLOCATION DETAIL</p>
              <h2>
                {String((allocationDetail.fleet as RecordItem)?.vehicleNumber)}{" "}
                · {String((allocationDetail.rider as RecordItem)?.name)}
              </h2>
              <p>
                <Status value={String(allocationDetail.status)} />
              </p>
            </div>
            <div className="detail-grid">
              <div>
                <strong>Rider</strong>
                <span>
                  {String(
                    (allocationDetail.rider as RecordItem)?.mobile ?? "—",
                  )}
                </span>
              </div>
              <div>
                <strong>Fleet</strong>
                <span>
                  {String((allocationDetail.fleet as RecordItem)?.oem ?? "—")}
                </span>
              </div>
              <div>
                <strong>Location</strong>
                <span>
                  {vehicleState?.latitude && vehicleState?.longitude
                    ? `${String(vehicleState.latitude)}, ${String(vehicleState.longitude)}`
                    : "No location received"}
                </span>
              </div>
              <div>
                <strong>Last heartbeat</strong>
                <span>
                  {vehicleState?.lastHeartbeat
                    ? new Date(
                        String(vehicleState.lastHeartbeat),
                      ).toLocaleString()
                    : "Not received"}
                </span>
              </div>
            </div>
            <h3>Inspections</h3>
            <div className="inspection-summary">
              {((allocationDetail.inspections as RecordItem[]) ?? []).map(
                (inspection) => (
                  <span key={String(inspection.id)}>
                    <b>{String(inspection.type).replaceAll("_", " ")}</b>{" "}
                    <Status value={String(inspection.status)} />
                  </span>
                ),
              )}
            </div>
            <button
              className="secondary"
              onClick={() => setAllocationDetail(null)}
            >
              Close detail
            </button>
          </section>
        )}
        {fleetDetail && (
          <section className="action-card detail-card">
            <p className="eyebrow">FLEET DETAIL</p><h2>{String(fleetDetail.vehicleNumber)}</h2>
            <div className="detail-grid"><div><strong>OEM / model</strong><span>{String(fleetDetail.oem ?? "—")} {String(fleetDetail.model ?? "")}</span></div><div><strong>Status</strong><Status value={String(fleetDetail.status)} /></div><div><strong>Hub</strong><span>{String((fleetDetail.hub as RecordItem)?.name ?? "—")}</span></div><div><strong>Last heartbeat</strong><span>{vehicleState?.lastHeartbeat ? new Date(String(vehicleState.lastHeartbeat)).toLocaleString() : "Not received"}</span></div></div>
            <h3>Components</h3><div className="inspection-summary"><span><b>Batteries</b> {((fleetDetail.batteries as RecordItem[]) ?? []).length}</span><span><b>Controllers</b> {((fleetDetail.controllers as RecordItem[]) ?? []).length}</span></div>
            <button className="secondary" onClick={() => setFleetDetail(null)}>Close detail</button>
          </section>
        )}
        {riderDetail && (
          <section className="action-card detail-card">
            <p className="eyebrow">RIDER DETAIL</p>
            <h2>{String(riderDetail.name)}</h2>
            <div className="detail-grid">
              <div>
                <strong>Mobile</strong>
                <span>{String(riderDetail.mobile)}</span>
              </div>
              <div>
                <strong>Status</strong>
                <Status value={String(riderDetail.status)} />
              </div>
            </div>
            <h3>KYC</h3>
            <div className="inspection-summary">
              {((riderDetail.kycs as RecordItem[]) ?? []).map((kyc) => (
                <span key={String(kyc.id)}>
                  <b>{String(kyc.type)}</b>{" "}
                  <Status value={String(kyc.status)} />
                </span>
              ))}
            </div>
            <h3>Open allocations</h3>
            <div className="inspection-summary">
              {((riderDetail.allocations as RecordItem[]) ?? []).map(
                (allocation) => (
                  <span key={String(allocation.id)}>
                    {String((allocation.fleet as RecordItem)?.vehicleNumber)}{" "}
                    <Status value={String(allocation.status)} />
                  </span>
                ),
              )}
            </div>
            <button className="secondary" onClick={() => setRiderDetail(null)}>
              Close detail
            </button>
          </section>
        )}
        {!loading && tab === "dashboard" && dashboard && (
          <div className="dashboard-grid">
            <Metric
              label="Total fleet"
              value={Object.values(dashboard.fleet).reduce(
                (sum, value) => sum + value,
                0,
              )}
            />
            <Metric label="Available" value={dashboard.fleet.AVAILABLE ?? 0} />
            <Metric
              label="Active allocations"
              value={dashboard.activeAllocations}
            />
            <Metric label="IoT online" value={dashboard.iot.online} />
            <Metric label="IoT offline" value={dashboard.iot.offline} />
            <Metric label="KYC pending" value={dashboard.riders.PENDING ?? 0} />
          </div>
        )}
        {!loading && tab !== "dashboard" && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {tab === "fleets" ? (
                      <>
                        <th>Vehicle</th>
                        <th>OEM</th>
                        <th>Status</th>
                        <th>Hub</th>
                        <th />
                      </>
                    ) : tab === "riders" ? (
                      <>
                        <th>Rider</th>
                        <th>Mobile</th>
                        <th>Status</th>
                        <th />
                      </>
                    ) : (
                      <>
                        <th>Fleet</th>
                        <th>Rider</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th />
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) =>
                    tab === "fleets" ? (
                      <tr key={String(item.id)}>
                        <td>{String(item.vehicleNumber)}</td>
                        <td>{String(item.oem)}</td>
                        <td>
                          <Status value={String(item.status)} />
                        </td>
                        <td>
                          {((item.hub as RecordItem | null)?.name as string) ??
                            "—"}
                        </td>
                        <td><button className="secondary table-action" onClick={() => void openFleetDetail(String(item.id))}>View</button></td>
                      </tr>
                    ) : tab === "riders" ? (
                      <tr key={String(item.id)}>
                        <td>{String(item.name)}</td>
                        <td>{String(item.mobile)}</td>
                        <td>
                          <Status value={String(item.status)} />
                        </td>
                        <td>
                          <button
                            className="secondary table-action"
                            onClick={() =>
                              void openRiderDetail(String(item.id))
                            }
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ) : (
                      <tr key={String(item.id)}>
                        <td>
                          {String(
                            (item.fleet as RecordItem)?.vehicleNumber ?? "—",
                          )}
                        </td>
                        <td>
                          {String((item.rider as RecordItem)?.name ?? "—")}
                        </td>
                        <td>
                          <Status value={String(item.status)} />
                        </td>
                        <td>
                          {new Date(
                            String(item.createdAt),
                          ).toLocaleDateString()}
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="secondary table-action"
                              onClick={() =>
                                void openAllocationDetail(String(item.id))
                              }
                            >
                              View
                            </button>
                            <button
                              className="secondary table-action"
                              onClick={() => void openInspection(item)}
                            >
                              Inspect
                            </button>
                            {item.status === "OTP_PENDING" && (
                              <button
                                className="table-action"
                                onClick={() =>
                                  void activateAllocation(String(item.id))
                                }
                              >
                                Activate
                              </button>
                            )}
                            {item.status === "ACTIVE" && (
                              <button
                                className="table-action"
                                onClick={() => void initiateDeallocation(item)}
                              >
                                Deallocate
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
              {items.length === 0 && (
                <p className="empty">No records match this view.</p>
              )}
            </div>
            <div className="form-actions pagination">
              <button
                className="secondary"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <span>
                Page {meta.page} · {meta.total} records
              </span>
              <button
                className="secondary"
                disabled={page * meta.pageSize >= meta.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

"use client";

import { FormEvent, useEffect, useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api/v1";
const ACCESS_TOKEN_KEY = "evs-eye-access-token";
const REFRESH_TOKEN_KEY = "evs-eye-refresh-token";
const AUTH_CHANGED_EVENT = "evs-eye-auth-changed";
type Tab =
  | "dashboard"
  | "fleets"
  | "riders"
  | "allocations"
  | "audit"
  | "locations"
  | "evidence";
type PhotoRequirementEntityType =
  | "RIDER"
  | "FLEET"
  | "BATTERY"
  | "CONTROLLER"
  | "INSPECTION";
type RecordItem = Record<string, unknown>;

interface Dashboard {
  fleet: Record<string, number>;
  riders: Record<string, number>;
  kyc: Record<string, number>;
  operations: {
    allocationsToday: number;
    deallocationsToday: number;
    activeAllocations: number;
  };
  iot: { online: number; offline: number };
}

interface ApiBody {
  data?: unknown;
  message?: string;
  error?: {
    code?: string;
    message?: string;
  };
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

let refreshInFlight: Promise<string | null> | null = null;

function normalizeDashboard(value: unknown): Dashboard {
  const data = value as Partial<Dashboard> | null;
  return {
    fleet: data?.fleet ?? {},
    riders: data?.riders ?? {},
    kyc: data?.kyc ?? {},
    operations: {
      allocationsToday: data?.operations?.allocationsToday ?? 0,
      deallocationsToday: data?.operations?.deallocationsToday ?? 0,
      activeAllocations: data?.operations?.activeAllocations ?? 0,
    },
    iot: {
      online: data?.iot?.online ?? 0,
      offline: data?.iot?.offline ?? 0,
    },
  };
}

async function sendRequest(
  path: string,
  options: RequestInit = {},
  token?: string,
) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as ApiBody;
  return { response, body };
}

async function refreshAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return null;

    const { response, body } = await sendRequest("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });
    const tokens = body.data as Partial<TokenPair> | undefined;
    if (!response.ok || !tokens?.accessToken || !tokens.refreshToken) {
      sessionStorage.removeItem(ACCESS_TOKEN_KEY);
      sessionStorage.removeItem(REFRESH_TOKEN_KEY);
      window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
      return null;
    }

    sessionStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
    return tokens.accessToken;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

async function request(
  path: string,
  options: RequestInit = {},
  token?: string,
) {
  let { response, body } = await sendRequest(path, options, token);
  if (response.status === 401 && token && path !== "/auth/refresh") {
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken)
      ({ response, body } = await sendRequest(path, options, refreshedToken));
  }
  if (!response.ok) {
    const retryAfter = response.headers.get("retry-after");
    if (response.status === 429) {
      const waitMessage = retryAfter
        ? ` Please wait ${retryAfter} second${retryAfter === "1" ? "" : "s"} and try again.`
        : " Please wait a moment and try again.";
      throw new Error(`Too many requests.${waitMessage}`);
    }

    throw new Error(
      body.error?.message ??
        body.message ??
        "Request failed. Please try again.",
    );
  }
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
  const [companyCode, setCompanyCode] = useState("");
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
  const [newRiderAddress, setNewRiderAddress] = useState("");
  const [showFleetForm, setShowFleetForm] = useState(false);
  const [hubs, setHubs] = useState<RecordItem[]>([]);
  const [newHub, setNewHub] = useState({ name: "", code: "" });
  const [newFleet, setNewFleet] = useState({
    vehicleNumber: "",
    chassisNumber: "",
    hubId: "",
    oem: "",
    model: "",
    colour: "",
    vehicleType: "",
    motorNumber: "",
    registrationDate: "",
    insuranceStartDate: "",
    insuranceEndDate: "",
    fitnessRenewalDate: "",
  });
  const [inspectionId, setInspectionId] = useState("");
  const [inspectionType, setInspectionType] = useState("PRE_ALLOCATION");
  const [requirements, setRequirements] = useState<RecordItem[]>([]);
  const [configuredRequirements, setConfiguredRequirements] = useState<
    RecordItem[]
  >([]);
  const [photoRequirementEntityType, setPhotoRequirementEntityType] =
    useState<PhotoRequirementEntityType>("INSPECTION");
  const [newRequirementType, setNewRequirementType] = useState("");
  const [newRequirementRequired, setNewRequirementRequired] = useState(true);
  const [uploadedPhotoTypes, setUploadedPhotoTypes] = useState<string[]>([]);
  const [inspectionPhotoProgress, setInspectionPhotoProgress] = useState<
    Record<string, number>
  >({});
  const [requiredInspectionPhotos, setRequiredInspectionPhotos] = useState(0);
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
  const [editingRider, setEditingRider] = useState(false);
  const [riderDraft, setRiderDraft] = useState({
    name: "",
    mobile: "",
    address: "",
    status: "PENDING",
  });
  const [fleetDetail, setFleetDetail] = useState<RecordItem | null>(null);
  const [fleetOnboardingStatus, setFleetOnboardingStatus] =
    useState<RecordItem | null>(null);
  const [fleetPhotoRequirements, setFleetPhotoRequirements] = useState<
    RecordItem[]
  >([]);
  const [uploadedFleetPhotoTypes, setUploadedFleetPhotoTypes] = useState<
    string[]
  >([]);
  const [componentPhotoRequirements, setComponentPhotoRequirements] = useState<
    Record<string, RecordItem[]>
  >({});
  const [uploadedComponentPhotoTypes, setUploadedComponentPhotoTypes] =
    useState<Record<string, string[]>>({});
  const [iotDeviceNumber, setIotDeviceNumber] = useState("");
  const [ingestSecret, setIngestSecret] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const syncToken = () => {
      const saved = sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? "";
      setToken(saved);
    };
    const timer = window.setTimeout(syncToken, 0);
    window.addEventListener(AUTH_CHANGED_EVENT, syncToken);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(AUTH_CHANGED_EVENT, syncToken);
    };
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
        setDashboard(
          normalizeDashboard(await request("/dashboard", {}, token)),
        );
      else if (nextTab === "locations") {
        setHubs((await request("/hubs", {}, token)) as RecordItem[]);
      } else if (nextTab === "evidence") {
        await loadPhotoRequirements(photoRequirementEntityType);
      } else {
        const query = new URLSearchParams({
          page: String(page),
          pageSize: "20",
        });
        if (search) query.set("search", search);
        if (statusFilter) query.set("status", statusFilter);
        const resource = nextTab === "audit" ? "/audit-logs" : `/${nextTab}`;
        const result = (await request(
          `${resource}?${query.toString()}`,
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

  function navigateTo(nextTab: Tab) {
    setShowAllocationForm(false);
    setShowRiderForm(false);
    setShowFleetForm(false);
    setInspectionId("");
    setDeallocationId("");
    setRiderDetail(null);
    setFleetDetail(null);
    setFleetOnboardingStatus(null);
    setEditingRider(false);
    setIngestSecret("");
    setSearch("");
    setStatusFilter("");
    setPage(1);
    setNotice("");
    setError("");
    setTab(nextTab);
  }

  async function sendOtp(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = (await request("/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ phone, companyCode }),
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
      })) as TokenPair;
      sessionStorage.setItem(ACCESS_TOKEN_KEY, data.accessToken);
      sessionStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
      const identity = (await request("/auth/me", {}, data.accessToken)) as {
        clientId: string | null;
        roles: string[];
      };
      window.location.assign(
        identity.roles.includes("SUPER_ADMIN")
          ? "/platform/dashboard"
          : "/client",
      );
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
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await request(
        "/riders",
        {
          method: "POST",
          body: JSON.stringify({
            name: newRiderName,
            mobile: newRiderMobile,
            ...(newRiderAddress ? { address: newRiderAddress } : {}),
          }),
        },
        token,
      );
      setShowRiderForm(false);
      setNewRiderName("");
      setNewRiderMobile("");
      setNewRiderAddress("");
      setNotice(
        "Rider created. Add a profile photo and start KYC from rider detail.",
      );
      await loadView("riders");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to create rider.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function createFleet(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await request(
        "/fleets",
        {
          method: "POST",
          body: JSON.stringify(
            Object.fromEntries(
              Object.entries(newFleet).filter(([, value]) => value !== ""),
            ),
          ),
        },
        token,
      );
      setShowFleetForm(false);
      setNewFleet({
        vehicleNumber: "",
        chassisNumber: "",
        hubId: "",
        oem: "",
        model: "",
        colour: "",
        vehicleType: "",
        motorNumber: "",
        registrationDate: "",
        insuranceStartDate: "",
        insuranceEndDate: "",
        fitnessRenewalDate: "",
      });
      setNotice(
        "Fleet created. Add components, photos, and IoT device from fleet detail.",
      );
      await loadView("fleets");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to create fleet.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function openFleetForm() {
    setLoading(true);
    setError("");
    try {
      setHubs((await request("/hubs", {}, token)) as RecordItem[]);
      setShowFleetForm(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load hubs.");
    } finally {
      setLoading(false);
    }
  }

  async function createHub(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await request(
        "/hubs",
        { method: "POST", body: JSON.stringify(newHub) },
        token,
      );
      setNewHub({ name: "", code: "" });
      setNotice("Hub created.");
      await loadView("locations");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to create hub.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function savePhotoRequirement(
    photoType: string,
    isRequired: boolean,
    sortOrder: number,
  ) {
    setLoading(true);
    setError("");
    try {
      const requirement = (await request(
        `/media/photo-requirements/${photoRequirementEntityType}/${photoType}`,
        {
          method: "PUT",
          body: JSON.stringify({ isRequired, sortOrder }),
        },
        token,
      )) as RecordItem;
      setConfiguredRequirements((current) => {
        const existingIndex = current.findIndex(
          (item) => String(item.photoType) === photoType,
        );
        if (existingIndex === -1) return [...current, requirement];
        return current.map((item) =>
          String(item.photoType) === photoType ? requirement : item,
        );
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to save photo requirement.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function addPhotoRequirement(event: FormEvent) {
    event.preventDefault();
    const photoType = newRequirementType.trim().toUpperCase();
    if (!photoType) return;
    await savePhotoRequirement(
      photoType,
      newRequirementRequired,
      configuredRequirements.length,
    );
    setNewRequirementType("");
    setNewRequirementRequired(true);
  }

  async function loadPhotoRequirements(entityType: PhotoRequirementEntityType) {
    setLoading(true);
    setError("");
    try {
      setConfiguredRequirements(
        (await request(
          `/media/photo-requirements?entityType=${entityType}`,
          {},
          token,
        )) as RecordItem[],
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load photo requirements.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function addFleetComponent(
    fleetId: string,
    component: "batteries" | "controllers",
    serialNumber: string,
  ) {
    if (!serialNumber) return;
    setLoading(true);
    setError("");
    try {
      await request(
        `/fleets/${fleetId}/${component}`,
        { method: "POST", body: JSON.stringify({ serialNumber }) },
        token,
      );
      setNotice(
        `${component === "batteries" ? "Battery" : "Controller"} added.`,
      );
      await openFleetDetail(fleetId);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to add component.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function registerIotDevice(fleetId: string) {
    setLoading(true);
    setError("");
    try {
      const data = (await request(
        "/iot/devices",
        {
          method: "POST",
          body: JSON.stringify({ fleetId, deviceNumber: iotDeviceNumber }),
        },
        token,
      )) as { ingestSecret: string };
      setIngestSecret(data.ingestSecret);
      setIotDeviceNumber("");
      setNotice(
        "IoT device registered. Save the ingestion secret now; it is shown only once.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to register IoT device.",
      );
    } finally {
      setLoading(false);
    }
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
      const inspections =
        (detail.inspections as RecordItem[] | undefined) ?? [];
      const [currentState, photoRequirements, inspectionDetails] =
        await Promise.all([
          request(
            `/fleets/${String(fleet.id)}/current-state`,
            {},
            token,
          ) as Promise<RecordItem | null>,
          request(
            "/media/photo-requirements?entityType=INSPECTION",
            {},
            token,
          ) as Promise<RecordItem[]>,
          Promise.all(
            inspections.map(async (inspection) => {
              const details = (await request(
                `/inspections/${String(inspection.id)}`,
                {},
                token,
              )) as { photos: RecordItem[] };
              return [
                String(inspection.id),
                details.photos.filter((photo) => photo.status === "COMPLETE")
                  .length,
              ] as const;
            }),
          ),
        ]);
      setVehicleState(currentState);
      setRequiredInspectionPhotos(
        photoRequirements.filter((requirement) => requirement.isRequired)
          .length,
      );
      setInspectionPhotoProgress(Object.fromEntries(inspectionDetails));
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
      const rider = (await request(
        `/riders/${riderId}`,
        {},
        token,
      )) as RecordItem;
      setRiderDetail(rider);
      setRiderDraft({
        name: String(rider.name ?? ""),
        mobile: String(rider.mobile ?? ""),
        address: String(rider.address ?? ""),
        status: String(rider.status ?? "PENDING"),
      });
      setEditingRider(false);
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

  async function updateRider(event: FormEvent) {
    event.preventDefault();
    if (!riderDetail) return;
    setLoading(true);
    setError("");
    try {
      await request(
        `/riders/${String(riderDetail.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify(riderDraft),
        },
        token,
      );
      setNotice("Rider updated.");
      await openRiderDetail(String(riderDetail.id));
      await loadView("riders");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to update rider.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function openFleetDetail(fleetId: string) {
    setLoading(true);
    setError("");
    try {
      const [fleet, currentState, onboardingStatus, photoRequirements, photos] =
        await Promise.all([
          request(`/fleets/${fleetId}`, {}, token) as Promise<RecordItem>,
          request(
            `/fleets/${fleetId}/current-state`,
            {},
            token,
          ) as Promise<RecordItem | null>,
          request(
            `/fleets/${fleetId}/onboarding-status`,
            {},
            token,
          ) as Promise<RecordItem>,
          request(
            "/media/photo-requirements?entityType=FLEET",
            {},
            token,
          ) as Promise<RecordItem[]>,
          request(
            `/media/photos?entityType=FLEET&entityId=${fleetId}`,
            {},
            token,
          ) as Promise<RecordItem[]>,
        ]);
      setFleetDetail(fleet);
      setVehicleState(currentState);
      setFleetOnboardingStatus(onboardingStatus);
      setFleetPhotoRequirements(photoRequirements);
      setUploadedFleetPhotoTypes(
        photos
          .filter((photo) => photo.status === "COMPLETE")
          .map((photo) => String(photo.photoType)),
      );
      const [batteryRequirements, controllerRequirements] = await Promise.all([
        request(
          "/media/photo-requirements?entityType=BATTERY",
          {},
          token,
        ) as Promise<RecordItem[]>,
        request(
          "/media/photo-requirements?entityType=CONTROLLER",
          {},
          token,
        ) as Promise<RecordItem[]>,
      ]);
      setComponentPhotoRequirements({
        BATTERY: batteryRequirements,
        CONTROLLER: controllerRequirements,
      });
      const components = [
        ...((fleet.batteries as RecordItem[]) ?? []).map((component) => ({
          entityType: "BATTERY" as const,
          id: String(component.id),
        })),
        ...((fleet.controllers as RecordItem[]) ?? []).map((component) => ({
          entityType: "CONTROLLER" as const,
          id: String(component.id),
        })),
      ];
      const componentPhotos = await Promise.all(
        components.map(async (component) => ({
          key: `${component.entityType}:${component.id}`,
          photos: (await request(
            `/media/photos?entityType=${component.entityType}&entityId=${component.id}`,
            {},
            token,
          )) as RecordItem[],
        })),
      );
      setUploadedComponentPhotoTypes(
        Object.fromEntries(
          componentPhotos.map(({ key, photos: componentPhotoItems }) => [
            key,
            componentPhotoItems
              .filter((photo) => photo.status === "COMPLETE")
              .map((photo) => String(photo.photoType)),
          ]),
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load fleet details.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function refreshFleetOnboardingStatus(fleetId: string) {
    setFleetOnboardingStatus(
      (await request(
        `/fleets/${fleetId}/onboarding-status`,
        {},
        token,
      )) as RecordItem,
    );
  }

  async function startKyc(
    riderId: string,
    type: "AADHAAR" | "PAN" | "BANK_ACCOUNT",
  ) {
    setLoading(true);
    setError("");
    try {
      await request(
        `/riders/${riderId}/kyc`,
        { method: "POST", body: JSON.stringify({ type }) },
        token,
      );
      setNotice(`${type.replaceAll("_", " ")} verification started.`);
      await openRiderDetail(riderId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start KYC.");
    } finally {
      setLoading(false);
    }
  }

  async function uploadRiderPhoto(riderId: string, file: File | undefined) {
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const intent = (await request(
        "/media/upload-intents",
        {
          method: "POST",
          body: JSON.stringify({
            entityType: "RIDER",
            entityId: riderId,
            photoType: "PROFILE",
            mimeType: file.type,
            fileName: file.name,
            sizeBytes: file.size,
          }),
        },
        token,
      )) as { photo: { id: string }; uploadUrl: string };
      const result = await fetch(intent.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!result.ok)
        throw new Error("Object storage rejected the file upload.");
      await request(
        `/media/${intent.photo.id}/complete`,
        { method: "POST" },
        token,
      );
      setNotice("Rider profile photo uploaded.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to upload rider photo.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function uploadFleetPhoto(
    fleetId: string,
    file: File | undefined,
    photoType: string,
  ) {
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError("Choose a JPEG, PNG, or WebP image smaller than 5 MB.");
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
            entityType: "FLEET",
            entityId: fleetId,
            photoType,
            mimeType: file.type,
            fileName: file.name,
            sizeBytes: file.size,
          }),
        },
        token,
      )) as { photo: { id: string }; uploadUrl: string };
      const result = await fetch(intent.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!result.ok)
        throw new Error("Object storage rejected the file upload.");
      await request(
        `/media/${intent.photo.id}/complete`,
        { method: "POST" },
        token,
      );
      setUploadedFleetPhotoTypes((current) =>
        current.includes(photoType) ? current : [...current, photoType],
      );
      await refreshFleetOnboardingStatus(fleetId);
      setNotice(`${photoType.replaceAll("_", " ")} photo uploaded.`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to upload fleet photo.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function uploadComponentPhoto(
    entityType: "BATTERY" | "CONTROLLER",
    componentId: string,
    file: File | undefined,
    photoType: string,
  ) {
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError("Choose a JPEG, PNG, or WebP image smaller than 5 MB.");
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
            entityType,
            entityId: componentId,
            photoType,
            mimeType: file.type,
            fileName: file.name,
            sizeBytes: file.size,
          }),
        },
        token,
      )) as { photo: { id: string }; uploadUrl: string };
      const result = await fetch(intent.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!result.ok)
        throw new Error("Object storage rejected the file upload.");
      await request(
        `/media/${intent.photo.id}/complete`,
        { method: "POST" },
        token,
      );
      const key = `${entityType}:${componentId}`;
      setUploadedComponentPhotoTypes((current) => ({
        ...current,
        [key]: current[key]?.includes(photoType)
          ? current[key]
          : [...(current[key] ?? []), photoType],
      }));
      if (fleetDetail) {
        await refreshFleetOnboardingStatus(String(fleetDetail.id));
      }
      setNotice(`${photoType.replaceAll("_", " ")} photo uploaded.`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to upload component photo.",
      );
    } finally {
      setLoading(false);
    }
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

  async function signOut() {
    const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_KEY);
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    setToken("");
    setOtpRequestId("");
    setCode("");
    setDashboard(null);
    setItems([]);
    if (!refreshToken || !token) return;
    try {
      await request(
        "/auth/logout",
        { method: "POST", body: JSON.stringify({ refreshToken }) },
        token,
      );
    } catch {
      // Local sign-out is still correct when the network is unavailable.
    }
  }

  if (!token)
    return (
      <main className="auth-shell">
        <section
          className="auth-hero"
          aria-label="EVs Eye fleet operations platform"
        />
        <section className="auth-panel">
          <div className="auth-card">
            <p className="eyebrow">SECURE OPERATIONS ACCESS</p>
            <h2>{otpRequestId ? "Verify your number" : "Welcome back"}</h2>
            <p className="muted">
              {otpRequestId
                ? `Enter the six-digit code sent to ${phone}.`
                : "Sign in to your EV fleet workspace."}
            </p>
            {!otpRequestId ? (
              <form onSubmit={sendOtp} className="auth-form">
                <label>
                  Company code
                  <span className="auth-input">
                    <span aria-hidden="true">⌂</span>
                    <input
                      value={companyCode}
                      onChange={(e) => setCompanyCode(e.target.value)}
                      placeholder="e.g. acme-fleet"
                      autoComplete="organization"
                      required
                    />
                  </span>
                </label>
                <label>
                  Mobile number
                  <span className="auth-input">
                    <span aria-hidden="true">⌕</span>
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 99999 99999"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      required
                    />
                  </span>
                </label>
                <button className="auth-submit" disabled={loading}>
                  {loading ? "Sending code…" : "Send OTP"}
                  <span aria-hidden="true">→</span>
                </button>
              </form>
            ) : (
              <form onSubmit={verifyOtp} className="auth-form">
                <label>
                  Six-digit OTP
                  <span className="auth-input auth-otp-input">
                    <span aria-hidden="true">#</span>
                    <input
                      value={code}
                      onChange={(e) =>
                        setCode(e.target.value.replace(/\D/g, ""))
                      }
                      placeholder="Enter verification code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      autoFocus
                    />
                  </span>
                </label>
                <button className="auth-submit" disabled={loading}>
                  {loading ? "Verifying…" : "Verify and enter"}
                  <span aria-hidden="true">→</span>
                </button>
                <button
                  type="button"
                  className="auth-text-button"
                  onClick={() => {
                    setOtpRequestId("");
                    setCode("");
                    setNotice("");
                    setError("");
                  }}
                >
                  Change mobile number
                </button>
              </form>
            )}
            {notice && <p className="notice auth-message">{notice}</p>}
            {error && <p className="error auth-message">{error}</p>}
            <p className="auth-security-note">
              <span aria-hidden="true">◈</span> Protected by OTP verification
            </p>
            <a className="platform-back-link" href="/platform">
              Platform Super Admin sign in
            </a>
          </div>
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
          {(
            [
              "dashboard",
              "fleets",
              "riders",
              "allocations",
              "locations",
              "evidence",
              "audit",
            ] as Tab[]
          ).map((item) => (
            <button
              key={item}
              className={tab === item ? "nav-active" : ""}
              onClick={() => navigateTo(item)}
            >
              {item}
            </button>
          ))}
        </nav>
        <button className="sign-out" onClick={signOut}>
          Sign out
        </button>
      </aside>
      <section className="workspace">
        <header>
          <div>
            <p className="eyebrow">CLIENT WORKSPACE</p>
            <h1>{title}</h1>
          </div>
          <div className="header-actions">
            {tab === "allocations" && (
              <button onClick={() => void openAllocationForm()}>
                New allocation
              </button>
            )}
            {tab === "riders" && (
              <button onClick={() => setShowRiderForm(true)}>New rider</button>
            )}
            {tab === "fleets" && (
              <button onClick={() => void openFleetForm()}>New fleet</button>
            )}
            <button className="secondary" onClick={() => void loadView(tab)}>
              Refresh
            </button>
          </div>
        </header>
        {tab !== "dashboard" &&
          tab !== "audit" &&
          tab !== "locations" &&
          tab !== "evidence" && (
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
        {!loading && tab === "locations" && (
          <>
            <div className="detail-grid">
              <section className="action-card">
                <p className="eyebrow">LOCATION SETUP</p>
                <h2>Create hub</h2>
                <form className="form-stack" onSubmit={createHub}>
                  <label>
                    Hub name
                    <input
                      value={newHub.name}
                      onChange={(event) =>
                        setNewHub((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      required
                    />
                  </label>
                  <label>
                    Hub code
                    <input
                      value={newHub.code}
                      onChange={(event) =>
                        setNewHub((current) => ({
                          ...current,
                          code: event.target.value.toUpperCase(),
                        }))
                      }
                      pattern="[A-Z0-9_-]+"
                      required
                    />
                  </label>
                  <button>Create hub</button>
                </form>
              </section>
            </div>
            <section className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Hub</th>
                    <th>Code</th>
                  </tr>
                </thead>
                <tbody>
                  {hubs.map((hub) => (
                    <tr key={String(hub.id)}>
                      <td>{String(hub.name)}</td>
                      <td>{String(hub.code)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hubs.length === 0 && <p className="empty">No hubs yet.</p>}
            </section>
          </>
        )}
        {!loading && tab === "evidence" && (
          <>
            <section className="action-card">
              <p className="eyebrow">PHOTO EVIDENCE SETTINGS</p>
              <h2>Required photo slots</h2>
              <p className="muted">
                Manage client-specific onboarding and inspection evidence. Turn
                a slot off when it is optional.
              </p>
              <label>
                Evidence type
                <select
                  value={photoRequirementEntityType}
                  disabled={loading}
                  onChange={(event) => {
                    const entityType = event.target
                      .value as PhotoRequirementEntityType;
                    setPhotoRequirementEntityType(entityType);
                    void loadPhotoRequirements(entityType);
                  }}
                >
                  <option value="RIDER">Rider profile</option>
                  <option value="FLEET">Fleet onboarding</option>
                  <option value="BATTERY">Battery</option>
                  <option value="CONTROLLER">Controller</option>
                  <option value="INSPECTION">Allocation inspection</option>
                </select>
              </label>
              <form className="form-stack" onSubmit={addPhotoRequirement}>
                <label>
                  New photo type
                  <input
                    value={newRequirementType}
                    onChange={(event) =>
                      setNewRequirementType(event.target.value.toUpperCase())
                    }
                    placeholder="e.g. DAMAGE_CLOSEUP"
                    pattern="[A-Z0-9_-]{1,80}"
                    maxLength={80}
                    required
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={newRequirementRequired}
                    onChange={(event) =>
                      setNewRequirementRequired(event.target.checked)
                    }
                  />{" "}
                  Required for completion
                </label>
                <button disabled={loading}>Add photo type</button>
              </form>
            </section>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Photo type</th>
                    <th>Required</th>
                    <th>Order</th>
                  </tr>
                </thead>
                <tbody>
                  {configuredRequirements.map((requirement) => {
                    const photoType = String(requirement.photoType);
                    const required = Boolean(requirement.isRequired);
                    return (
                      <tr key={String(requirement.id)}>
                        <td>{photoType.replaceAll("_", " ")}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={required}
                            disabled={loading}
                            onChange={(event) =>
                              void savePhotoRequirement(
                                photoType,
                                event.target.checked,
                                Number(requirement.sortOrder ?? 0),
                              )
                            }
                          />
                        </td>
                        <td>{String(requirement.sortOrder ?? 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {configuredRequirements.length === 0 && (
                <p className="empty">No photo types configured.</p>
              )}
            </div>
          </>
        )}
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
        {showRiderForm && (
          <section className="action-card">
            <p className="eyebrow">RIDER ONBOARDING</p>
            <h2>Create rider</h2>
            <form className="form-stack" onSubmit={createRider}>
              <label>
                Name
                <input
                  value={newRiderName}
                  onChange={(event) => setNewRiderName(event.target.value)}
                  required
                />
              </label>
              <label>
                Mobile
                <input
                  value={newRiderMobile}
                  onChange={(event) => setNewRiderMobile(event.target.value)}
                  placeholder="+919999999999"
                  required
                />
              </label>
              <label>
                Address
                <textarea
                  value={newRiderAddress}
                  onChange={(event) => setNewRiderAddress(event.target.value)}
                  maxLength={500}
                  rows={3}
                />
              </label>
              <div className="form-actions">
                <button disabled={loading}>Create rider</button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowRiderForm(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        )}
        {showFleetForm && (
          <section className="action-card">
            <p className="eyebrow">FLEET ONBOARDING</p>
            <h2>Create fleet</h2>
            <form className="form-stack" onSubmit={createFleet}>
              {(
                ["vehicleNumber", "chassisNumber", "oem", "model"] as const
              ).map((field) => (
                <label key={field}>
                  {field.replace(/([A-Z])/g, " $1")}
                  <input
                    value={newFleet[field]}
                    onChange={(event) =>
                      setNewFleet((current) => ({
                        ...current,
                        [field]: event.target.value,
                      }))
                    }
                    required={
                      field === "vehicleNumber" || field === "chassisNumber"
                    }
                  />
                </label>
              ))}
              <label>
                Hub
                <select
                  value={newFleet.hubId}
                  onChange={(event) =>
                    setNewFleet((current) => ({
                      ...current,
                      hubId: event.target.value,
                    }))
                  }
                >
                  <option value="">No hub assigned</option>
                  {hubs.map((hub) => (
                    <option key={String(hub.id)} value={String(hub.id)}>
                      {String(hub.name)} · {String(hub.code)}
                    </option>
                  ))}
                </select>
              </label>
              {(["colour", "vehicleType", "motorNumber"] as const).map(
                (field) => (
                  <label key={field}>
                    {field.replace(/([A-Z])/g, " $1")}
                    <input
                      value={newFleet[field]}
                      onChange={(event) =>
                        setNewFleet((current) => ({
                          ...current,
                          [field]: event.target.value,
                        }))
                      }
                    />
                  </label>
                ),
              )}
              {(
                [
                  "registrationDate",
                  "insuranceStartDate",
                  "insuranceEndDate",
                  "fitnessRenewalDate",
                ] as const
              ).map((field) => (
                <label key={field}>
                  {field.replace(/([A-Z])/g, " $1")}
                  <input
                    type="date"
                    value={newFleet[field]}
                    onChange={(event) =>
                      setNewFleet((current) => ({
                        ...current,
                        [field]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
              <div className="form-actions">
                <button disabled={loading}>Create fleet</button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowFleetForm(false)}
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
                    <Status value={String(inspection.status)} /> ·{" "}
                    {inspectionPhotoProgress[String(inspection.id)] ?? 0}/
                    {requiredInspectionPhotos} required photos
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
            <p className="eyebrow">FLEET DETAIL</p>
            <h2>{String(fleetDetail.vehicleNumber)}</h2>
            {fleetOnboardingStatus && (
              <div
                className={
                  fleetOnboardingStatus.ready
                    ? "onboarding-status ready"
                    : "onboarding-status incomplete"
                }
              >
                <strong>
                  {fleetOnboardingStatus.ready
                    ? "✓ Onboarding evidence complete"
                    : "! Onboarding evidence incomplete"}
                </strong>
                {!fleetOnboardingStatus.ready && (
                  <span>
                    {((fleetOnboardingStatus.items as RecordItem[]) ?? [])
                      .filter(
                        (item) =>
                          (item.missingPhotoTypes as string[]).length > 0,
                      )
                      .map(
                        (item) =>
                          `${String(item.label)}: ${(
                            item.missingPhotoTypes as string[]
                          )
                            .map((photoType) => photoType.replaceAll("_", " "))
                            .join(", ")}`,
                      )
                      .join(" · ")}
                  </span>
                )}
              </div>
            )}
            <h3>Fleet onboarding photos</h3>
            {fleetPhotoRequirements.length > 0 ? (
              <div className="photo-slots">
                {fleetPhotoRequirements.map((requirement) => {
                  const photoType = String(requirement.photoType);
                  const complete = uploadedFleetPhotoTypes.includes(photoType);
                  return (
                    <label
                      key={String(requirement.id)}
                      className={
                        complete ? "photo-slot complete" : "photo-slot"
                      }
                    >
                      <span>
                        {complete ? "✓" : "○"} {photoType.replaceAll("_", " ")}
                        {requirement.isRequired ? " · Required" : " · Optional"}
                      </span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={loading}
                        onChange={(event) =>
                          void uploadFleetPhoto(
                            String(fleetDetail.id),
                            event.target.files?.[0],
                            photoType,
                          )
                        }
                      />
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="muted">
                No fleet photo slots have been configured.
              </p>
            )}
            <div className="detail-grid">
              <div>
                <strong>OEM / model</strong>
                <span>
                  {String(fleetDetail.oem ?? "—")}{" "}
                  {String(fleetDetail.model ?? "")}
                </span>
              </div>
              <div>
                <strong>Status</strong>
                <Status value={String(fleetDetail.status)} />
              </div>
              <div>
                <strong>Hub</strong>
                <span>
                  {String((fleetDetail.hub as RecordItem)?.name ?? "—")}
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
            <h3>Components</h3>
            <div className="inspection-summary">
              <span>
                <b>Batteries</b>{" "}
                {((fleetDetail.batteries as RecordItem[]) ?? []).length}
              </span>
              <span>
                <b>Controllers</b>{" "}
                {((fleetDetail.controllers as RecordItem[]) ?? []).length}
              </span>
            </div>
            {(
              [
                {
                  entityType: "BATTERY" as const,
                  label: "Battery",
                  components: (fleetDetail.batteries as RecordItem[]) ?? [],
                },
                {
                  entityType: "CONTROLLER" as const,
                  label: "Controller",
                  components: (fleetDetail.controllers as RecordItem[]) ?? [],
                },
              ] as const
            ).map(({ entityType, label, components }) =>
              components.map((component) => {
                const componentId = String(component.id);
                const uploaded =
                  uploadedComponentPhotoTypes[`${entityType}:${componentId}`] ??
                  [];
                const requirements =
                  componentPhotoRequirements[entityType] ?? [];
                return (
                  <section className="component-evidence" key={componentId}>
                    <h4>
                      {label}: {String(component.serialNumber)}
                    </h4>
                    <div className="photo-slots">
                      {requirements.map((requirement) => {
                        const photoType = String(requirement.photoType);
                        const complete = uploaded.includes(photoType);
                        return (
                          <label
                            key={String(requirement.id)}
                            className={
                              complete ? "photo-slot complete" : "photo-slot"
                            }
                          >
                            <span>
                              {complete ? "✓" : "○"}{" "}
                              {photoType.replaceAll("_", " ")}
                              {requirement.isRequired
                                ? " · Required"
                                : " · Optional"}
                            </span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              disabled={loading}
                              onChange={(event) =>
                                void uploadComponentPhoto(
                                  entityType,
                                  componentId,
                                  event.target.files?.[0],
                                  photoType,
                                )
                              }
                            />
                          </label>
                        );
                      })}
                    </div>
                  </section>
                );
              }),
            )}
            <h3>IoT device</h3>
            <div className="form-actions">
              <input
                value={iotDeviceNumber}
                onChange={(event) => setIotDeviceNumber(event.target.value)}
                placeholder="Device number"
              />
              <button
                disabled={loading || !iotDeviceNumber}
                onClick={() => void registerIotDevice(String(fleetDetail.id))}
              >
                Register device
              </button>
            </div>
            {ingestSecret && (
              <p className="notice">
                Save this ingestion secret now: <code>{ingestSecret}</code>{" "}
                <button
                  className="secondary table-action"
                  onClick={() =>
                    void navigator.clipboard.writeText(ingestSecret)
                  }
                >
                  Copy
                </button>
              </p>
            )}
            <div className="form-actions">
              <input id="battery-serial" placeholder="Battery serial" />
              <button
                onClick={() => {
                  const input = document.getElementById(
                    "battery-serial",
                  ) as HTMLInputElement;
                  void addFleetComponent(
                    String(fleetDetail.id),
                    "batteries",
                    input.value,
                  );
                }}
              >
                Add battery
              </button>
              <input id="controller-serial" placeholder="Controller serial" />
              <button
                onClick={() => {
                  const input = document.getElementById(
                    "controller-serial",
                  ) as HTMLInputElement;
                  void addFleetComponent(
                    String(fleetDetail.id),
                    "controllers",
                    input.value,
                  );
                }}
              >
                Add controller
              </button>
            </div>
            <button
              className="secondary"
              onClick={() => {
                setFleetDetail(null);
                setFleetOnboardingStatus(null);
                setIngestSecret("");
              }}
            >
              Close detail
            </button>
          </section>
        )}
        {riderDetail && (
          <section className="action-card detail-card">
            <p className="eyebrow">RIDER DETAIL</p>
            <h2>{String(riderDetail.name)}</h2>
            <label className="photo-slot">
              <span>Profile photo</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={loading}
                onChange={(event) =>
                  void uploadRiderPhoto(
                    String(riderDetail.id),
                    event.target.files?.[0],
                  )
                }
              />
            </label>
            <div className="detail-grid">
              <div>
                <strong>Mobile</strong>
                <span>{String(riderDetail.mobile)}</span>
              </div>
              <div>
                <strong>Status</strong>
                <Status value={String(riderDetail.status)} />
              </div>
              <div>
                <strong>Address</strong>
                <span>{String(riderDetail.address ?? "—")}</span>
              </div>
            </div>
            <button
              className="secondary"
              onClick={() => setEditingRider((current) => !current)}
            >
              {editingRider ? "Cancel edit" : "Edit rider"}
            </button>
            {editingRider && (
              <form className="form-stack" onSubmit={updateRider}>
                <label>
                  Name
                  <input
                    value={riderDraft.name}
                    onChange={(event) =>
                      setRiderDraft((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    required
                  />
                </label>
                <label>
                  Mobile
                  <input
                    value={riderDraft.mobile}
                    onChange={(event) =>
                      setRiderDraft((current) => ({
                        ...current,
                        mobile: event.target.value,
                      }))
                    }
                    required
                  />
                </label>
                <label>
                  Address
                  <textarea
                    value={riderDraft.address}
                    onChange={(event) =>
                      setRiderDraft((current) => ({
                        ...current,
                        address: event.target.value,
                      }))
                    }
                    maxLength={500}
                    rows={3}
                  />
                </label>
                <label>
                  Rider status
                  <select
                    value={riderDraft.status}
                    onChange={(event) =>
                      setRiderDraft((current) => ({
                        ...current,
                        status: event.target.value,
                      }))
                    }
                  >
                    {["PENDING", "ACTIVE", "INACTIVE", "BLOCKED"].map(
                      (status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <div className="form-actions">
                  <button disabled={loading}>Save rider</button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setEditingRider(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
            <h3>KYC</h3>
            <div className="inspection-summary">
              {((riderDetail.kycs as RecordItem[]) ?? []).map((kyc) => (
                <span key={String(kyc.id)}>
                  <b>{String(kyc.type)}</b>{" "}
                  <Status value={String(kyc.status)} />
                </span>
              ))}
            </div>
            <div className="form-actions">
              {(["AADHAAR", "PAN", "BANK_ACCOUNT"] as const).map((type) => (
                <button
                  key={type}
                  className="secondary table-action"
                  disabled={loading}
                  onClick={() => void startKyc(String(riderDetail.id), type)}
                >
                  Start {type.replaceAll("_", " ")}
                </button>
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
            <Metric label="Allocated" value={dashboard.fleet.ALLOCATED ?? 0} />
            <Metric label="In use" value={dashboard.fleet.IN_USE ?? 0} />
            <Metric
              label="Maintenance"
              value={dashboard.fleet.MAINTENANCE ?? 0}
            />
            <Metric
              label="Fleet offline"
              value={dashboard.fleet.OFFLINE ?? 0}
            />
            <Metric
              label="Out of service"
              value={dashboard.fleet.OUT_OF_SERVICE ?? 0}
            />
            <Metric
              label="Total riders"
              value={Object.values(dashboard.riders).reduce(
                (sum, value) => sum + value,
                0,
              )}
            />
            <Metric
              label="Active riders"
              value={dashboard.riders.ACTIVE ?? 0}
            />
            <Metric label="KYC pending" value={dashboard.kyc.PENDING ?? 0} />
            <Metric label="KYC verified" value={dashboard.kyc.VERIFIED ?? 0} />
            <Metric label="KYC failed" value={dashboard.kyc.FAILED ?? 0} />
            <Metric
              label="Active allocations"
              value={dashboard.operations.activeAllocations}
            />
            <Metric
              label="Allocations today"
              value={dashboard.operations.allocationsToday}
            />
            <Metric
              label="Deallocations today"
              value={dashboard.operations.deallocationsToday}
            />
            <Metric label="IoT online" value={dashboard.iot.online} />
            <Metric label="IoT offline" value={dashboard.iot.offline} />
          </div>
        )}
        {!loading &&
          tab !== "dashboard" &&
          tab !== "locations" &&
          tab !== "evidence" && (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {tab === "audit" ? (
                        <>
                          <th>Action</th>
                          <th>Entity</th>
                          <th>Actor</th>
                          <th>When</th>
                        </>
                      ) : tab === "fleets" ? (
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
                      tab === "audit" ? (
                        <tr key={String(item.id)}>
                          <td>{String(item.action)}</td>
                          <td>
                            {String(item.entityType)}
                            {item.entityId ? ` · ${String(item.entityId)}` : ""}
                          </td>
                          <td>{String(item.actorId ?? "System")}</td>
                          <td>
                            {new Date(String(item.createdAt)).toLocaleString()}
                          </td>
                        </tr>
                      ) : tab === "fleets" ? (
                        <tr key={String(item.id)}>
                          <td>{String(item.vehicleNumber)}</td>
                          <td>{String(item.oem)}</td>
                          <td>
                            <Status value={String(item.status)} />
                          </td>
                          <td>
                            {((item.hub as RecordItem | null)
                              ?.name as string) ?? "—"}
                          </td>
                          <td>
                            <button
                              className="secondary table-action"
                              onClick={() =>
                                void openFleetDetail(String(item.id))
                              }
                            >
                              View
                            </button>
                          </td>
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
                                  onClick={() =>
                                    void initiateDeallocation(item)
                                  }
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

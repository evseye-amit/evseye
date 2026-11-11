export type VehicleReadiness = {
  ready: boolean;
  blockers: string[];
  nextStep: string | null;
};

export type VehicleReadinessCell = {
  state: "ready" | "blocked" | "unavailable";
  blockers: string[];
  nextStep: string | null;
  guidance: string | null;
};

export const previewVehicleImpactMessage = (
  currentMode: string | null | undefined,
  proposedMode: string | null | undefined,
  vehicleImpact: unknown,
): string | null => {
  if (!Array.isArray(vehicleImpact)) return "Exact vehicle impact is unavailable.";
  if (vehicleImpact.length > 0) return null;
  return currentMode === proposedMode
    ? "No vehicle effects: this mode is unchanged."
    : "No vehicle effects are reported for this mode change.";
};

export const policySaveBody = <T extends {
  operatingMode: string;
  configuration: unknown;
  version: number;
}>(policy: T, reason: string) => ({
  operatingMode: policy.operatingMode,
  configuration: policy.configuration,
  expectedVersion: policy.version,
  reason,
});

export const readinessFrom = (value: unknown): VehicleReadiness | null => {
  if (!value || typeof value !== "object" || !("ready" in value) || typeof value.ready !== "boolean") return null;
  const blockers = "blockers" in value && Array.isArray(value.blockers)
    ? value.blockers.flatMap((blocker) => {
      if (typeof blocker === "string") return [blocker];
      if (blocker && typeof blocker === "object" && "message" in blocker && typeof blocker.message === "string") return [blocker.message];
      return [];
    })
    : [];
  const nextStep = "nextStep" in value && typeof value.nextStep === "string" && value.nextStep.trim() ? value.nextStep : null;
  return { ready: value.ready, blockers, nextStep };
};

export const readinessCellModel = (row: Record<string, unknown>): VehicleReadinessCell => {
  const readiness = readinessFrom(row.vehicleReadiness);
  const guidance = row.status === "ALLOCATED"
    ? "Return this vehicle in the Fleet Manager app."
    : row.status !== "AVAILABLE"
      ? null
      : !readiness
        ? "Readiness unavailable."
        : readiness.ready
          ? "Allocate in the Fleet Manager app."
          : "Complete vehicle readiness first.";
  return {
    state: !readiness ? "unavailable" : readiness.ready ? "ready" : "blocked",
    blockers: readiness?.blockers ?? [],
    nextStep: readiness?.nextStep ?? null,
    guidance,
  };
};

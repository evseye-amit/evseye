/**
 * Form select values mirror the Prisma enums in apps/api/prisma/schema.prisma.
 * Keep enum values here so both panels submit the exact API contract.
 */
export const featureCategories: Array<[string, string]> = [
  ["LOGIN", "Login"],
  ["RIDER_ONBOARDING", "Rider Onboarding"],
  ["RIDER_VERIFICATION", "Rider Verification / KYC"],
  ["RIDER_TRAINING", "Rider Training"],
  ["RIDER_MANAGEMENT", "Rider Management"],
  ["ATTENDANCE", "Attendance & Workforce"],
  ["FACE_RECOGNITION", "Face Recognition"],
  ["FLEET_MANAGEMENT", "Fleet Management"],
  ["VEHICLE_MANAGEMENT", "Vehicle Management"],
  ["IOT_TELEMATICS", "IoT & Telematics"],
  ["TRACKING_GEOFENCING", "Tracking & Geofencing"],
  ["BATTERY_MANAGEMENT", "Battery Management"],
  ["SERVICE_MAINTENANCE", "Service & Maintenance"],
  ["MECHANIC_MANAGEMENT", "Mechanic Management"],
  ["SAFETY_COMPLIANCE", "Safety & Compliance"],
  ["ANALYTICS", "Analytics"],
  ["REPORTING", "Reports"],
  ["NOTIFICATION", "Notifications"],
  ["INTEGRATION", "Integrations"],
  ["API_ACCESS", "API Access"],
  ["USER_ACCESS", "Users & Access"],
  ["DOCUMENT_MANAGEMENT", "Document Management"],
  ["USER_VERIFICATION", "User Verification"],
  ["COUPON", "Coupon"],
  ["TRAINING", "Training"],
  ["SUPPORT", "Support"],
  ["AI_AUTOMATION", "AI & Automation"],
  ["OTHER", "Other"],
];

export const featureTypes = ["BOOLEAN", "QUANTITY", "USAGE_BASED", "CONFIGURATION"];
export const featureBillingUnits = [
  "SMS",
  "EMAIL",
  "UPLOAD",
  "WHATSAPP_MESSAGE",
  "VERIFICATION",
  "RIDER",
  "VEHICLE",
  "FLEET",
  "USER",
  "API_CALL",
  "FACE_SCAN",
  "TRAINING",
  "DEVICE",
  "GB",
  "MONTH",
  "AI_CREDIT",
  "LIFE_TIME",
];

export const masterRecordStatuses = ["ACTIVE", "INACTIVE", "SUSPENDED"];
export const energyTypes = ["ELECTRIC", "HYBRID", "PETROL", "DIESEL", "CNG", "HYDROGEN", "OTHER", "LPG"];
export const vehicleUsageTypes = ["PRIVATE", "PASSENGER", "GOODS", "DELIVERY", "SHARED_MOBILITY", "PUBLIC_TRANSPORT", "STAFF_TRANSPORT", "SCHOOL_TRANSPORT", "EMERGENCY", "AGRICULTURAL", "CONSTRUCTION", "INDUSTRIAL", "RENTAL", "GOVERNMENT", "SPECIAL_PURPOSE"];
export const billingCycles = ["ONCE", "MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"];
export const allowanceResetPeriods = ["NONE", "DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"];
export const clientIndustries = ["LOGISTICS", "LAST_MILE", "DELIVERY", "MOBILITY", "RENTAL", "OTHER"];
export const fleetBusinessModels = ["OWNED", "LEASED", "ATTACHED", "MIXED"];
export const vehicleOwnerships = ["OWNED", "LEASED", "DRIVER_OWNED", "MIXED"];

export const vehicleSpeedTypes = ["SLOW_SPEED", "HIGH_SPEED"];
export const fleetOwnershipTypes = ["CLIENT_OWNED", "LEASED", "ATTACHED", "OEM_OWNED", "THIRD_PARTY"];
export const insuranceTypes = ["THIRD_PARTY", "COMPREHENSIVE", "OWN_DAMAGE"];
export const batterySlots = ["PRIMARY", "SECONDARY", "AUXILIARY"];
export const batteryTypes = ["FIXED_SINGLE", "FIXED_DOUBLE", "SWAP_IF", "SWAP_BS", "SWAP_MOVING", "SWAP_OTHER"];
export const hubTypes = ["OPERATIONS", "PARKING", "CHARGING", "BATTERY_SWAP", "MAINTENANCE", "WAREHOUSE", "DELIVERY", "MIXED"];
export const hubStatuses = ["ACTIVE", "INACTIVE", "TEMPORARILY_CLOSED", "UNDER_MAINTENANCE", "FULL"];
export const photoEntityTypes = ["RIDER", "FLEET", "BATTERY", "CONTROLLER", "INSPECTION"];
export const riderStatuses = ["ONBOARDING", "ACTIVE", "INACTIVE", "BLOCKED", "EXITED"];
export const kycTypes = ["AADHAAR", "PAN", "BANK_ACCOUNT"] as const;

export function enumOptionLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function photoEntityTypeLabel(value: string) {
  const labels: Record<string, string> = {
    RIDER: "Rider profile",
    FLEET: "Fleet onboarding",
    INSPECTION: "Allocation inspection",
  };
  return labels[value] ?? enumOptionLabel(value);
}

// GENERATED CONTRACT. Do not edit by hand.
export const PRE_LOGIN_ERROR_CODES = ["WORKSPACE_NOT_FOUND","WORKSPACE_UNAVAILABLE","WORKSPACE_HOST_MISMATCH","WORKSPACE_INACTIVE","WORKSPACE_PENDING_APPROVAL","WORKSPACE_SUSPENDED","UNSUPPORTED_APP_ROLE","WORKSPACE_CONFIGURATION_INVALID","WORKSPACE_DOMAIN_UNVERIFIED"] as const;
export type PreLoginErrorCode = (typeof PRE_LOGIN_ERROR_CODES)[number];
export const isPreLoginErrorCode = (value: unknown): value is PreLoginErrorCode => typeof value === 'string' && (PRE_LOGIN_ERROR_CODES as readonly string[]).includes(value);

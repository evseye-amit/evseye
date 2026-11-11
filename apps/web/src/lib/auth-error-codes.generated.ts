// GENERATED CONTRACT. Do not edit by hand.
export const AUTH_ERROR_CODES = ["OTP_INVALID_REQUEST","OTP_INVALID","OTP_EXPIRED","OTP_ALREADY_USED","REFRESH_TOKEN_EXPIRED","REFRESH_TOKEN_INVALID","SESSION_UNAVAILABLE","SESSION_REVOKED"] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];
export const isAuthErrorCode = (value: unknown): value is AuthErrorCode => typeof value === 'string' && (AUTH_ERROR_CODES as readonly string[]).includes(value);

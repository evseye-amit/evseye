# SMS delivery

All login OTPs for Super Admin, Client Operations, Fleet Manager, and Rider use the same `SmsProvider` interface in `apps/api/src/auth/sms`. Select the adapter with `SMS_PROVIDER=console` or `SMS_PROVIDER=telipia`. A new provider can implement `SmsProvider` and be registered in `AuthModule` without changing the login controllers.

## Telipia configuration

Set these server-only environment variables in the deployment secret manager:

- `TELIPIA_API_URL`: the provider's verified HTTPS API endpoint
- `TELIPIA_USERNAME`, `TELIPIA_API_KEY`: account credentials
- `TELIPIA_SENDER`: registered sender ID
- `TELIPIA_ROUTE`: route, defaults to `TRANS`
- `TELIPIA_LOGIN_TEMPLATE_ID`: approved login OTP DLT template ID
- `TELIPIA_DEALLOCATION_TEMPLATE_ID`: approved deallocation OTP template ID, if using that flow

Then set `SMS_PROVIDER=telipia`. The login message is the approved text supplied for this integration, with a generated six-digit OTP substituted into it. The HTTP adapter URL-encodes all query parameters, uses a ten-digit Indian mobile, refuses redirects, and times out after ten seconds. Request URLs, provider responses, credentials, and OTPs must never be logged.

The originally supplied `telipiacloud.in` host did not present a TLS certificate for that hostname when checked. Obtain a verified HTTPS endpoint from the provider before enabling live delivery. Do not disable TLS verification or place the API key in an HTTP URL. The console provider remains suitable for local testing; its fixed development OTP is only used when `SMS_PROVIDER=console`.

Failed delivery marks the OTP request `FAILED` and returns a service unavailable error. The client may retry immediately. A successful gateway HTTP response without an explicit failure marker is treated as accepted; confirm Telipia's exact success and error response format with the provider before production activation.

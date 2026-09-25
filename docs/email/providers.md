# Welcome email provider

The Super Admin client creation flow sends the Account Admin a welcome email after the client transaction commits. The six-step onboarding flow sends it after final submission. Email failure does not roll back the client; the API returns `welcomeEmail.status` and writes an audit event.

`ClientWelcomeService` uses the `EmailProvider` interface. `Msg91EmailProvider` owns MSG91's HTTP payload and response handling; `DisabledEmailProvider` is used when delivery is off. To add another provider, implement the interface and register it in `EmailModule`.

For MSG91, configure these server-only settings:

```text
EMAIL_PROVIDER=msg91
MSG91_EMAIL_DOMAIN=mail.evseye.com
MSG91_EMAIL_FROM=no-reply@mail.evseye.com
MSG91_WELCOME_TEMPLATE_ID=welcome_client_mail
CLIENT_LOGIN_URL=https://your-client-login-host/
```

Set `MSG91_AUTH_KEY` through the deployment secret manager or ignored local `.env`. Do not put it in committed files or client-side environment variables. The welcome template at `docs/email/client-welcome.html` uses `client_name`, `company_name`, `company_code`, `registered_mobile_number`, and `login_url`. Register that template under the configured template ID in MSG91. The provider sends to the Account Admin email supplied at onboarding.

The app treats MSG91 HTTP acceptance as accepted for delivery, not proof of inbox delivery. Provider failure details and the auth key are never returned to the client. Tests mock the provider and do not send live email.

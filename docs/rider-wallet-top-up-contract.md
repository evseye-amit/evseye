# Rider Wallet — Add Money API Contract

## Create top-up order

`POST /rider-app/payments/orders`

Headers:

```http
Authorization: Bearer <access-token>
Idempotency-Key: <unique-key>
Content-Type: application/json
```

Request:

```json
{
  "purpose": "TOP_UP",
  "amount": "500.00"
}
```

Rules:

- Amount must contain exactly two decimal places.
- Minimum: `500.00`
- Maximum: `5000.00`
- Currency: INR.
- Top-ups are non-refundable and non-withdrawable.
- Reuse the same `Idempotency-Key` when retrying the same request.
- Do not reuse an idempotency key with a different amount.

Response:

```json
{
  "data": {
    "paymentRequestId": "collection:<uuid>",
    "purpose": "TOP_UP",
    "provider": "CASHFREE",
    "status": "PENDING",
    "amount": "500.00",
    "currency": "INR",
    "providerOrderId": "EVSEYE_PG_...",
    "providerPaymentId": null,
    "failureCode": null,
    "checkout": {
      "orderId": "EVSEYE_PG_...",
      "paymentSessionId": "..."
    },
    "nextAction": "AWAITING_GATEWAY_CONFIRMATION"
  }
}
```

The `checkout` object contains the configured provider’s checkout values. Do not hardcode a provider in the app.

## Payment status

`GET /rider-app/payments/orders/:paymentRequestId`

Possible statuses:

```text
CREATING
PENDING
SUCCEEDED
FAILED
EXPIRED
UNKNOWN
REVIEW_REQUIRED
```

Only `SUCCEEDED` means that the wallet has been credited.

## Verify payment

`POST /rider-app/payments/orders/:paymentRequestId/verify`

For Cashfree, send an empty object:

```json
{}
```

For Razorpay, send the values returned by the Razorpay SDK:

```json
{
  "razorpayOrderId": "order_...",
  "razorpayPaymentId": "pay_...",
  "razorpaySignature": "..."
}
```

The backend validates the provider response, amount, order identity, and signature where applicable.

## Wallet balance

After a successful top-up, reload either endpoint:

```http
GET /rider-app/wallet
GET /rider-app/wallet/balance
```

The balance is updated only after server-side payment settlement.

## Wallet transaction history

```http
GET /rider-app/wallet/transactions?page=1&pageSize=20
```

Successful top-up:

```json
{
  "transactionType": "TOP_UP",
  "status": "POSTED",
  "amount": "500.00",
  "currency": "INR",
  "description": "Money added to wallet",
  "referenceType": "PAYMENT_COLLECTION",
  "referenceId": "collection-uuid",
  "postedAt": "2026-11-13T12:01:00.000Z"
}
```

Failed or expired attempts remain visible for transparency:

```json
{
  "transactionType": "TOP_UP",
  "status": "FAILED",
  "amount": "500.00",
  "currency": "INR",
  "description": "Money added to wallet",
  "postedAt": null
}
```

Only `POSTED` transactions affect the wallet balance.

## Recommended Flutter flow

```text
1. Validate the amount locally for user feedback.
2. Create a TOP_UP order with a new Idempotency-Key.
3. Open the configured provider checkout using checkout data.
4. Call verify after checkout completion.
5. Poll payment status if it is PENDING or UNKNOWN.
6. When status is SUCCEEDED, reload wallet balance and transaction history.
7. Show FAILED or EXPIRED attempts as unsuccessful transactions.
```

The app must not:

- Credit the wallet locally.
- Trust the provider callback amount or success state.
- Treat checkout completion alone as wallet credit.
- Retry with a new idempotency key while the previous request is pending.
- Offer refund or withdrawal actions for top-ups.

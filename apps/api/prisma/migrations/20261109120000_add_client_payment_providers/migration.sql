CREATE TABLE "ClientPaymentProvider" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "provider" VARCHAR(32) NOT NULL DEFAULT 'RAZORPAY',
    "environment" VARCHAR(16) NOT NULL DEFAULT 'PRODUCTION',
    "merchantAccountId" VARCHAR(128),
    "keyId" VARCHAR(128) NOT NULL,
    "secretReference" VARCHAR(512) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientPaymentProvider_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientPaymentProvider_clientId_provider_environment_key"
    ON "ClientPaymentProvider"("clientId", "provider", "environment");

CREATE INDEX "ClientPaymentProvider_clientId_provider_status_idx"
    ON "ClientPaymentProvider"("clientId", "provider", "status");

ALTER TABLE "ClientPaymentProvider"
    ADD CONSTRAINT "ClientPaymentProvider_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

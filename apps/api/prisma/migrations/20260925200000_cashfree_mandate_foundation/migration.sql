CREATE TYPE "PaymentMandateStatus" AS ENUM ('CREATING', 'CREATED', 'AUTHORIZATION_PENDING', 'ACTIVE', 'PAUSED', 'CANCELLED', 'FAILED', 'EXPIRED', 'UNKNOWN');
CREATE TYPE "PaymentProviderEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

CREATE TABLE "PaymentMandate" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "riderId" TEXT NOT NULL,
  "requestKey" VARCHAR(120) NOT NULL,
  "provider" VARCHAR(30) NOT NULL DEFAULT 'CASHFREE',
  "providerMandateId" VARCHAR(250) NOT NULL,
  "authorizationSessionId" TEXT,
  "status" "PaymentMandateStatus" NOT NULL DEFAULT 'CREATING',
  "providerStatus" VARCHAR(80),
  "mode" VARCHAR(30) NOT NULL DEFAULT 'ON_DEMAND',
  "method" VARCHAR(30) NOT NULL DEFAULT 'UPI_AUTOPAY',
  "maxAmount" DECIMAL(14,2) NOT NULL,
  "authorizationAmount" DECIMAL(14,2),
  "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "authorizedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentMandate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentMandate_providerMandateId_key" ON "PaymentMandate"("providerMandateId");
CREATE UNIQUE INDEX "PaymentMandate_clientId_riderId_requestKey_key" ON "PaymentMandate"("clientId", "riderId", "requestKey");
CREATE UNIQUE INDEX "PaymentMandate_clientId_id_key" ON "PaymentMandate"("clientId", "id");
CREATE INDEX "PaymentMandate_clientId_riderId_status_idx" ON "PaymentMandate"("clientId", "riderId", "status");
CREATE UNIQUE INDEX "PaymentMandate_one_open_per_rider" ON "PaymentMandate"("clientId", "riderId")
  WHERE "status" IN ('CREATING', 'CREATED', 'AUTHORIZATION_PENDING', 'ACTIVE', 'PAUSED', 'UNKNOWN');
ALTER TABLE "PaymentMandate" ADD CONSTRAINT "PaymentMandate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentMandate" ADD CONSTRAINT "PaymentMandate_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PaymentMandateEvent" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "mandateId" TEXT NOT NULL,
  "fromStatus" "PaymentMandateStatus",
  "toStatus" "PaymentMandateStatus" NOT NULL,
  "source" VARCHAR(40) NOT NULL,
  "referenceId" VARCHAR(120),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentMandateEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PaymentMandateEvent_clientId_mandateId_createdAt_idx" ON "PaymentMandateEvent"("clientId", "mandateId", "createdAt");
ALTER TABLE "PaymentMandateEvent" ADD CONSTRAINT "PaymentMandateEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentMandateEvent" ADD CONSTRAINT "PaymentMandateEvent_clientId_mandateId_fkey" FOREIGN KEY ("clientId", "mandateId") REFERENCES "PaymentMandate"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PaymentProviderEvent" (
  "id" TEXT NOT NULL,
  "provider" VARCHAR(30) NOT NULL,
  "eventKey" VARCHAR(128) NOT NULL,
  "eventType" VARCHAR(100) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "clientId" TEXT,
  "mandateId" TEXT,
  "status" "PaymentProviderEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "failureReason" VARCHAR(150),
  CONSTRAINT "PaymentProviderEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentProviderEvent_provider_eventKey_key" ON "PaymentProviderEvent"("provider", "eventKey");
CREATE INDEX "PaymentProviderEvent_clientId_receivedAt_idx" ON "PaymentProviderEvent"("clientId", "receivedAt");
ALTER TABLE "PaymentProviderEvent" ADD CONSTRAINT "PaymentProviderEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentProviderEvent" ADD CONSTRAINT "PaymentProviderEvent_clientId_mandateId_fkey" FOREIGN KEY ("clientId", "mandateId") REFERENCES "PaymentMandate"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

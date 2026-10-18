CREATE UNIQUE INDEX "Allocation_clientId_id_key" ON "Allocation"("clientId", "id");
ALTER TABLE "RiderInvoice" ADD COLUMN "penaltyNotificationQueuedAt" TIMESTAMP(3);

CREATE TABLE "PenaltyHandoverException" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "riderId" TEXT NOT NULL,
  "allocationId" TEXT NOT NULL,
  "approvedById" TEXT NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "debtDigest" CHAR(64) NOT NULL,
  "debtSnapshot" JSONB NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt" TIMESTAMP(3),
  CONSTRAINT "PenaltyHandoverException_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PenaltyHandoverException_reason_nonblank" CHECK (length(btrim("reason")) > 0),
  CONSTRAINT "PenaltyHandoverException_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PenaltyHandoverException_clientId_riderId_fkey" FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PenaltyHandoverException_clientId_allocationId_fkey" FOREIGN KEY ("clientId", "allocationId") REFERENCES "Allocation"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PenaltyHandoverException_clientId_allocationId_debtDigest_key" ON "PenaltyHandoverException"("clientId", "allocationId", "debtDigest");
CREATE INDEX "PenaltyHandoverException_clientId_riderId_approvedAt_idx" ON "PenaltyHandoverException"("clientId", "riderId", "approvedAt");

ALTER TABLE "PenaltyHandoverException" ADD CONSTRAINT "PenaltyHandoverException_clientId_approvedById_fkey" FOREIGN KEY ("clientId", "approvedById") REFERENCES "User"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "rider_invoice_penalty_notification_idx" ON "RiderInvoice"("invoiceType", "penaltyNotificationQueuedAt", "createdAt");

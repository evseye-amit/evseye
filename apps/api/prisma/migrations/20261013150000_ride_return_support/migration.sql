ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'RETURN_PENALTY_APPROVAL';
ALTER TYPE "PhotoEntityType" ADD VALUE IF NOT EXISTS 'SUPPORT_TICKET';

ALTER TABLE "RentalTerminationRequest"
  ADD COLUMN "allocationId" TEXT,
  ADD COLUMN "plannedHubId" TEXT,
  ADD COLUMN "receivedHubId" TEXT,
  ADD COLUMN "requestSource" VARCHAR(20) NOT NULL DEFAULT 'STAFF',
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledById" TEXT,
  ADD COLUMN "receiptRecordedAt" TIMESTAMP(3),
  ADD COLUMN "receiptRecordedById" TEXT,
  ADD COLUMN "receiptBackdateReason" VARCHAR(500);

ALTER TABLE "Inspection"
  ADD COLUMN "safeForReuse" BOOLEAN,
  ADD COLUMN "unsafeReason" VARCHAR(500);

CREATE UNIQUE INDEX "RentalTerminationRequest_allocationId_key"
  ON "RentalTerminationRequest"("allocationId");
CREATE INDEX "RentalTerminationRequest_clientId_plannedHubId_status_idx"
  ON "RentalTerminationRequest"("clientId", "plannedHubId", "status");
CREATE INDEX "RentalTerminationRequest_clientId_receivedHubId_status_idx"
  ON "RentalTerminationRequest"("clientId", "receivedHubId", "status");

ALTER TABLE "RentalTerminationRequest"
  ADD CONSTRAINT "RentalTerminationRequest_allocationId_fkey"
  FOREIGN KEY ("allocationId") REFERENCES "Allocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RentalTerminationRequest_plannedHubId_fkey"
  FOREIGN KEY ("plannedHubId") REFERENCES "Hub"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RentalTerminationRequest_receivedHubId_fkey"
  FOREIGN KEY ("receivedHubId") REFERENCES "Hub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ReturnPenaltyPrice" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "code" VARCHAR(60) NOT NULL,
  "category" VARCHAR(30) NOT NULL,
  "description" VARCHAR(300) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReturnPenaltyPrice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReturnPenaltyPrice_clientId_code_key"
  ON "ReturnPenaltyPrice"("clientId", "code");
CREATE INDEX "ReturnPenaltyPrice_clientId_isActive_idx"
  ON "ReturnPenaltyPrice"("clientId", "isActive");
ALTER TABLE "ReturnPenaltyPrice"
  ADD CONSTRAINT "ReturnPenaltyPrice_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ReturnPenaltyPrice_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "ReturnPenaltyPrice_category_check" CHECK ("category" IN ('DAMAGE', 'MISSING_ITEM'));

CREATE TABLE "ReturnPenaltyCase" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "riderId" TEXT NOT NULL,
  "terminationRequestId" TEXT NOT NULL,
  "inspectionId" TEXT NOT NULL,
  "currentRevision" INTEGER NOT NULL DEFAULT 0,
  "digest" CHAR(64),
  "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  "status" VARCHAR(40) NOT NULL DEFAULT 'DRAFT',
  "submittedAt" TIMESTAMP(3),
  "submittedById" TEXT,
  "riderApprovedRevision" INTEGER,
  "riderApprovedAt" TIMESTAMP(3),
  "riderApprovalOtpRequestId" TEXT,
  "riderDisputedRevision" INTEGER,
  "riderDisputedAt" TIMESTAMP(3),
  "riderDisputeReason" VARCHAR(500),
  "adminOverrideRevision" INTEGER,
  "adminOverrideAt" TIMESTAMP(3),
  "adminOverrideById" TEXT,
  "adminOverrideReason" VARCHAR(500),
  "managerApprovedRevision" INTEGER,
  "managerApprovedAt" TIMESTAMP(3),
  "managerApprovedById" TEXT,
  "postedRevision" INTEGER,
  "postedChargeId" TEXT,
  "postedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReturnPenaltyCase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReturnPenaltyCase_terminationRequestId_key"
  ON "ReturnPenaltyCase"("terminationRequestId");
CREATE UNIQUE INDEX "ReturnPenaltyCase_inspectionId_key"
  ON "ReturnPenaltyCase"("inspectionId");
CREATE UNIQUE INDEX "ReturnPenaltyCase_postedChargeId_key"
  ON "ReturnPenaltyCase"("postedChargeId");
CREATE UNIQUE INDEX "ReturnPenaltyCase_clientId_id_key"
  ON "ReturnPenaltyCase"("clientId", "id");
CREATE INDEX "ReturnPenaltyCase_clientId_riderId_status_updatedAt_idx"
  ON "ReturnPenaltyCase"("clientId", "riderId", "status", "updatedAt");
CREATE INDEX "ReturnPenaltyCase_clientId_status_updatedAt_idx"
  ON "ReturnPenaltyCase"("clientId", "status", "updatedAt");
ALTER TABLE "ReturnPenaltyCase"
  ADD CONSTRAINT "ReturnPenaltyCase_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ReturnPenaltyCase_clientId_riderId_fkey"
  FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ReturnPenaltyCase_terminationRequestId_fkey"
  FOREIGN KEY ("terminationRequestId") REFERENCES "RentalTerminationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ReturnPenaltyCase_inspectionId_fkey"
  FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ReturnPenaltyCase_postedChargeId_fkey"
  FOREIGN KEY ("postedChargeId") REFERENCES "RiderCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ReturnPenaltyCase_totalAmount_check" CHECK ("totalAmount" >= 0),
  ADD CONSTRAINT "ReturnPenaltyCase_currentRevision_check" CHECK ("currentRevision" >= 0);

CREATE TABLE "ReturnPenaltyItem" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "position" INTEGER NOT NULL,
  "priceListItemId" TEXT NOT NULL,
  "priceCode" VARCHAR(60),
  "category" VARCHAR(30),
  "description" VARCHAR(300),
  "amount" DECIMAL(14,2),
  "currency" CHAR(3),
  "details" VARCHAR(1000) NOT NULL,
  "evidencePhotoIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT NOT NULL,
  CONSTRAINT "ReturnPenaltyItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReturnPenaltyItem_caseId_revision_position_key"
  ON "ReturnPenaltyItem"("caseId", "revision", "position");
CREATE INDEX "ReturnPenaltyItem_clientId_caseId_revision_idx"
  ON "ReturnPenaltyItem"("clientId", "caseId", "revision");
ALTER TABLE "ReturnPenaltyItem"
  ADD CONSTRAINT "ReturnPenaltyItem_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "ReturnPenaltyCase"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ReturnPenaltyItem_priceListItemId_fkey"
  FOREIGN KEY ("priceListItemId") REFERENCES "ReturnPenaltyPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ReturnPenaltyItem_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "ReturnPenaltyItem_revision_check" CHECK ("revision" > 0),
  ADD CONSTRAINT "ReturnPenaltyItem_position_check" CHECK ("position" >= 0),
  ADD CONSTRAINT "ReturnPenaltyItem_category_check" CHECK ("category" IN ('DAMAGE', 'MISSING_ITEM'));

CREATE TABLE "SupportTicket" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "riderId" TEXT NOT NULL,
  "hubId" TEXT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  "subject" VARCHAR(160) NOT NULL,
  "description" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupportTicket_clientId_id_key" ON "SupportTicket"("clientId", "id");
CREATE INDEX "SupportTicket_clientId_riderId_lastActivityAt_id_idx"
  ON "SupportTicket"("clientId", "riderId", "lastActivityAt", "id");
CREATE INDEX "SupportTicket_clientId_hubId_lastActivityAt_id_idx"
  ON "SupportTicket"("clientId", "hubId", "lastActivityAt", "id");
CREATE INDEX "SupportTicket_clientId_status_lastActivityAt_id_idx"
  ON "SupportTicket"("clientId", "status", "lastActivityAt", "id");
ALTER TABLE "SupportTicket"
  ADD CONSTRAINT "SupportTicket_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SupportTicket_clientId_riderId_fkey"
  FOREIGN KEY ("clientId", "riderId") REFERENCES "Rider"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SupportTicket_hubId_fkey"
  FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "SupportTicket_status_check" CHECK ("status" IN ('OPEN', 'IN_PROGRESS', 'RESOLVED'));

CREATE TABLE "SupportReply" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportReply_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportReply_clientId_ticketId_createdAt_id_idx"
  ON "SupportReply"("clientId", "ticketId", "createdAt", "id");
ALTER TABLE "SupportReply"
  ADD CONSTRAINT "SupportReply_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SupportReply_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

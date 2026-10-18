CREATE TABLE "WorkPartnerMaster" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "status" "MasterRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkPartnerMaster_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientWorkPartner" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sourceMasterId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "status" "MasterRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientWorkPartner_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkPartnerMaster_code_key" ON "WorkPartnerMaster"("code");
CREATE INDEX "WorkPartnerMaster_status_name_idx" ON "WorkPartnerMaster"("status", "name");
CREATE UNIQUE INDEX "ClientWorkPartner_clientId_id_key" ON "ClientWorkPartner"("clientId", "id");
CREATE UNIQUE INDEX "ClientWorkPartner_clientId_code_key" ON "ClientWorkPartner"("clientId", "code");
CREATE INDEX "ClientWorkPartner_clientId_status_name_idx" ON "ClientWorkPartner"("clientId", "status", "name");

ALTER TABLE "ClientWorkPartner"
  ADD CONSTRAINT "ClientWorkPartner_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClientWorkPartner"
  ADD CONSTRAINT "ClientWorkPartner_sourceMasterId_fkey"
  FOREIGN KEY ("sourceMasterId") REFERENCES "WorkPartnerMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MobileDeploymentWorkflow" ADD COLUMN "clientWorkPartnerId" TEXT;

ALTER TABLE "MobileDeploymentWorkflow"
  ADD CONSTRAINT "MobileDeploymentWorkflow_clientId_clientWorkPartnerId_fkey"
  FOREIGN KEY ("clientId", "clientWorkPartnerId") REFERENCES "ClientWorkPartner"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

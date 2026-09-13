CREATE TYPE "ClientStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'SUSPENDED');
CREATE TYPE "ClientContactRole" AS ENUM ('PRIMARY', 'ACCOUNT_ADMIN', 'BILLING');
CREATE TYPE "ClientAddressType" AS ENUM ('REGISTERED', 'BILLING');
CREATE TYPE "ClientDocumentType" AS ENUM ('PAN_CARD', 'GST_CERTIFICATE', 'INCORPORATION_CERTIFICATE', 'FLEET_AGREEMENT', 'BUSINESS_AGREEMENT');
CREATE TYPE "DocumentVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
CREATE TYPE "FleetBusinessModel" AS ENUM ('OWNED', 'LEASED', 'ATTACHED', 'MIXED');
CREATE TYPE "VehicleOwnership" AS ENUM ('OWNED', 'LEASED', 'DRIVER_OWNED', 'MIXED');

ALTER TABLE "Tenant"
  ADD COLUMN "companyCode" TEXT,
  ADD COLUMN "status" "ClientStatus" NOT NULL DEFAULT 'DRAFT';

UPDATE "Tenant"
SET
  "companyCode" = "slug",
  "status" = CASE WHEN "isActive" THEN 'ACTIVE'::"ClientStatus" ELSE 'SUSPENDED'::"ClientStatus" END;

ALTER TABLE "Tenant" ALTER COLUMN "companyCode" SET NOT NULL;
CREATE UNIQUE INDEX "Tenant_companyCode_key" ON "Tenant"("companyCode");

ALTER TABLE "ClientProfile" RENAME TO "ClientBusinessProfile";
ALTER INDEX "ClientProfile_pkey" RENAME TO "ClientBusinessProfile_pkey";
ALTER INDEX "ClientProfile_clientId_key" RENAME TO "ClientBusinessProfile_clientId_key";

CREATE TABLE "ClientContact" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "role" "ClientContactRole" NOT NULL,
  "name" TEXT NOT NULL,
  "designation" TEXT,
  "mobile" TEXT,
  "email" TEXT,
  "alternateMobile" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientAddress" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "type" "ClientAddressType" NOT NULL,
  "line1" TEXT NOT NULL,
  "line2" TEXT,
  "landmark" TEXT,
  "city" TEXT NOT NULL,
  "district" TEXT,
  "state" TEXT NOT NULL,
  "country" TEXT NOT NULL DEFAULT 'India',
  "pinCode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientAddress_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ClientContact" ("id", "clientId", "role", "name", "designation", "mobile", "email", "alternateMobile", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "clientId", 'PRIMARY', "primaryContactName", "primaryContactTitle", "primaryContactMobile", "primaryContactEmail", "alternateMobile", "createdAt", "updatedAt"
FROM "ClientBusinessProfile";

INSERT INTO "ClientAddress" ("id", "clientId", "type", "line1", "line2", "landmark", "city", "district", "state", "country", "pinCode", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "clientId", 'REGISTERED', "registeredAddressLine1", "registeredAddressLine2", "landmark", "city", "district", "state", "country", "pinCode", "createdAt", "updatedAt"
FROM "ClientBusinessProfile";

ALTER TABLE "ClientBusinessProfile"
  ADD COLUMN "logoObjectKey" TEXT,
  ADD COLUMN "yearEstablished" INTEGER,
  ADD COLUMN "estimatedFleetSize" INTEGER,
  ADD COLUMN "estimatedRiderCount" INTEGER,
  ADD COLUMN "estimatedUserCount" INTEGER,
  DROP COLUMN "primaryContactName",
  DROP COLUMN "primaryContactTitle",
  DROP COLUMN "primaryContactMobile",
  DROP COLUMN "primaryContactEmail",
  DROP COLUMN "alternateMobile",
  DROP COLUMN "registeredAddressLine1",
  DROP COLUMN "registeredAddressLine2",
  DROP COLUMN "landmark",
  DROP COLUMN "city",
  DROP COLUMN "district",
  DROP COLUMN "state",
  DROP COLUMN "country",
  DROP COLUMN "pinCode";

CREATE TABLE "ClientOperationsProfile" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "fleetBusinessModel" "FleetBusinessModel" NOT NULL,
  "numberOfFleets" INTEGER NOT NULL,
  "approximateRiderCount" INTEGER NOT NULL,
  "vehicleOwnership" "VehicleOwnership" NOT NULL,
  "primaryVehicleTypeId" TEXT NOT NULL,
  "operationalHubCount" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientOperationsProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientBillingProfile" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "billingContactName" TEXT NOT NULL,
  "billingEmail" TEXT NOT NULL,
  "billingMobile" TEXT,
  "purchaseOrderRequired" BOOLEAN NOT NULL DEFAULT false,
  "poNumber" TEXT,
  "paymentTerms" TEXT,
  "taxApplicable" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientBillingProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientDocument" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "documentType" "ClientDocumentType" NOT NULL,
  "documentNumber" TEXT,
  "issueDate" DATE,
  "expiryDate" DATE,
  "objectKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "verificationStatus" "DocumentVerificationStatus" NOT NULL DEFAULT 'PENDING',
  "uploadedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientAgreement" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "authorizedSignatoryName" TEXT NOT NULL,
  "designation" TEXT NOT NULL,
  "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
  "privacyAcceptedAt" TIMESTAMP(3) NOT NULL,
  "dataProcessingConsentAt" TIMESTAMP(3) NOT NULL,
  "kycConsentAt" TIMESTAMP(3),
  "marketingConsentAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectedById" TEXT,
  "rejectionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientAgreement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientContact_clientId_role_key" ON "ClientContact"("clientId", "role");
CREATE INDEX "ClientContact_clientId_role_idx" ON "ClientContact"("clientId", "role");
CREATE UNIQUE INDEX "ClientAddress_clientId_type_key" ON "ClientAddress"("clientId", "type");
CREATE UNIQUE INDEX "ClientOperationsProfile_clientId_key" ON "ClientOperationsProfile"("clientId");
CREATE INDEX "ClientOperationsProfile_primaryVehicleTypeId_idx" ON "ClientOperationsProfile"("primaryVehicleTypeId");
CREATE UNIQUE INDEX "ClientBillingProfile_clientId_key" ON "ClientBillingProfile"("clientId");
CREATE UNIQUE INDEX "ClientDocument_objectKey_key" ON "ClientDocument"("objectKey");
CREATE INDEX "ClientDocument_clientId_documentType_verificationStatus_idx" ON "ClientDocument"("clientId", "documentType", "verificationStatus");
CREATE UNIQUE INDEX "ClientAgreement_clientId_key" ON "ClientAgreement"("clientId");

ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientAddress" ADD CONSTRAINT "ClientAddress_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientOperationsProfile" ADD CONSTRAINT "ClientOperationsProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientOperationsProfile" ADD CONSTRAINT "ClientOperationsProfile_primaryVehicleTypeId_fkey" FOREIGN KEY ("primaryVehicleTypeId") REFERENCES "VehicleType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientBillingProfile" ADD CONSTRAINT "ClientBillingProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientAgreement" ADD CONSTRAINT "ClientAgreement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

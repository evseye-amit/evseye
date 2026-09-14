-- Preserve the category of an existing single Vehicle Type selection, then
-- replace that single selection with an explicit multi-category relationship.
CREATE TABLE "ClientOperationsVehicleCategory" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "operationsProfileId" TEXT NOT NULL,
    "vehicleCategoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientOperationsVehicleCategory_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ClientOperationsVehicleCategory" (
    "id", "clientId", "operationsProfileId", "vehicleCategoryId", "createdAt"
)
SELECT
    md5("ClientOperationsProfile"."id" || ':' || "VehicleType"."categoryId"),
    "ClientOperationsProfile"."clientId",
    "ClientOperationsProfile"."id",
    "VehicleType"."categoryId",
    "ClientOperationsProfile"."createdAt"
FROM "ClientOperationsProfile"
INNER JOIN "VehicleType"
    ON "VehicleType"."id" = "ClientOperationsProfile"."primaryVehicleTypeId";

ALTER TABLE "ClientOperationsProfile"
    DROP CONSTRAINT "ClientOperationsProfile_primaryVehicleTypeId_fkey";

DROP INDEX "ClientOperationsProfile_primaryVehicleTypeId_idx";

ALTER TABLE "ClientOperationsProfile"
    DROP COLUMN "primaryVehicleTypeId";

CREATE UNIQUE INDEX "ClientOperationsVehicleCategory_operationsProfileId_vehicleCategoryId_key"
    ON "ClientOperationsVehicleCategory"("operationsProfileId", "vehicleCategoryId");
CREATE INDEX "ClientOperationsVehicleCategory_clientId_vehicleCategoryId_idx"
    ON "ClientOperationsVehicleCategory"("clientId", "vehicleCategoryId");
CREATE INDEX "ClientOperationsVehicleCategory_vehicleCategoryId_idx"
    ON "ClientOperationsVehicleCategory"("vehicleCategoryId");

ALTER TABLE "ClientOperationsVehicleCategory"
    ADD CONSTRAINT "ClientOperationsVehicleCategory_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientOperationsVehicleCategory"
    ADD CONSTRAINT "ClientOperationsVehicleCategory_operationsProfileId_fkey"
    FOREIGN KEY ("operationsProfileId") REFERENCES "ClientOperationsProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientOperationsVehicleCategory"
    ADD CONSTRAINT "ClientOperationsVehicleCategory_vehicleCategoryId_fkey"
    FOREIGN KEY ("vehicleCategoryId") REFERENCES "VehicleCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

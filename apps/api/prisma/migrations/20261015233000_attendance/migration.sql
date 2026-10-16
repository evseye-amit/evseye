CREATE TABLE "AttendancePeriod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT,
    "checkInAt" TIMESTAMP(3) NOT NULL,
    "checkOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttendancePeriod_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AttendancePeriod"
    ADD CONSTRAINT "AttendancePeriod_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AttendancePeriod"
    ADD CONSTRAINT "AttendancePeriod_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AttendancePeriod"
    ADD CONSTRAINT "AttendancePeriod_checkOutAt_check"
    CHECK ("checkOutAt" IS NULL OR "checkOutAt" > "checkInAt");

CREATE UNIQUE INDEX "AttendancePeriod_userId_open_key"
    ON "AttendancePeriod"("userId")
    WHERE "checkOutAt" IS NULL;

CREATE INDEX "AttendancePeriod_userId_checkInAt_idx"
    ON "AttendancePeriod"("userId", "checkInAt");

CREATE INDEX "AttendancePeriod_clientId_checkInAt_idx"
    ON "AttendancePeriod"("clientId", "checkInAt");

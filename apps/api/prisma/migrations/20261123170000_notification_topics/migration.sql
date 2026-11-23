ALTER TABLE "PushDevice" ADD COLUMN "topicReconciledAt" TIMESTAMP(3);
CREATE INDEX "PushDevice_topicReconciledAt_idx" ON "PushDevice"("topicReconciledAt");
CREATE TABLE "NotificationTopic" (
 id TEXT PRIMARY KEY, "clientId" TEXT NOT NULL, "bindingId" TEXT NOT NULL,
 "logicalKey" VARCHAR(300) NOT NULL, name VARCHAR(150) NOT NULL UNIQUE,
 "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("bindingId","logicalKey"), UNIQUE ("clientId","bindingId",id),
 FOREIGN KEY ("clientId","bindingId") REFERENCES "NotificationAppBinding"("clientId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "NotificationTopicSubscription" (
 id TEXT PRIMARY KEY, "clientId" TEXT NOT NULL, "bindingId" TEXT NOT NULL, "topicId" TEXT NOT NULL,
 "deviceVersion" INTEGER NOT NULL CHECK ("deviceVersion">0),
 "deviceId" TEXT REFERENCES "PushDevice"(id) ON DELETE SET NULL ON UPDATE CASCADE,
 token TEXT NOT NULL, "tokenHash" CHAR(64) NOT NULL, desired BOOLEAN NOT NULL, applied BOOLEAN,
 attempts INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
 "claimId" TEXT, "leaseUntil" TIMESTAMP(3), "lastError" VARCHAR(150), "lastAppliedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("bindingId","tokenHash","topicId"),
 FOREIGN KEY ("clientId","bindingId") REFERENCES "NotificationAppBinding"("clientId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("clientId","bindingId","topicId") REFERENCES "NotificationTopic"("clientId","bindingId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK (attempts >= 0)
);
CREATE INDEX "NotificationTopicSubscription_nextAttemptAt_leaseUntil_idx" ON "NotificationTopicSubscription"("nextAttemptAt","leaseUntil");
CREATE INDEX "NotificationTopicSubscription_deviceId_idx" ON "NotificationTopicSubscription"("deviceId");

-- Bring the installation lookup index in line with the preceding Prisma model.
CREATE INDEX IF NOT EXISTS "NotificationInstallation_clientId_bindingId_hasRegistered_idx" ON "NotificationInstallation"("clientId","bindingId","hasRegistered");

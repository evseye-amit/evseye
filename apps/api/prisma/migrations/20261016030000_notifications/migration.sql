-- CreateTable
CREATE TABLE "PushDevice" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "installationId" UUID NOT NULL,
    "appCode" VARCHAR(30) NOT NULL,
    "platform" VARCHAR(10) NOT NULL,
    "token" TEXT NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRegisteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledReason" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationMessage" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "senderId" TEXT,
    "title" VARCHAR(150) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "audience" VARCHAR(30) NOT NULL,
    "audiencePhones" TEXT[],
    "requestKey" VARCHAR(150) NOT NULL,
    "requestDigest" CHAR(64) NOT NULL,
    "source" VARCHAR(50) NOT NULL DEFAULT 'MANUAL',
    "status" VARCHAR(40) NOT NULL DEFAULT 'QUEUED',
    "totalUsers" INTEGER NOT NULL DEFAULT 0,
    "pushExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "NotificationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotification" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "expandedAt" TIMESTAMP(3),
    "noActiveDevice" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushDelivery" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userNotificationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceVersion" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstAttemptAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "claimId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "firebaseMessageId" TEXT,
    "errorCode" VARCHAR(150),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushDispatchState" (
    "id" TEXT NOT NULL,
    "nextAllowedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "claimId" TEXT,

    CONSTRAINT "PushDispatchState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PushDevice_clientId_userId_isActive_idx" ON "PushDevice"("clientId", "userId", "isActive");

-- CreateIndex
CREATE INDEX "PushDevice_sessionId_idx" ON "PushDevice"("sessionId");

-- CreateIndex
CREATE INDEX "PushDevice_tokenHash_idx" ON "PushDevice"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_installationId_appCode_key" ON "PushDevice"("installationId", "appCode");

-- CreateIndex
CREATE INDEX "NotificationMessage_clientId_createdAt_id_idx" ON "NotificationMessage"("clientId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "NotificationMessage_status_createdAt_idx" ON "NotificationMessage"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationMessage_clientId_requestKey_key" ON "NotificationMessage"("clientId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationMessage_clientId_id_key" ON "NotificationMessage"("clientId", "id");

-- CreateIndex
CREATE INDEX "UserNotification_clientId_userId_createdAt_id_idx" ON "UserNotification"("clientId", "userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "UserNotification_clientId_userId_readAt_idx" ON "UserNotification"("clientId", "userId", "readAt");

-- CreateIndex
CREATE INDEX "UserNotification_expandedAt_createdAt_idx" ON "UserNotification"("expandedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserNotification_messageId_userId_key" ON "UserNotification"("messageId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserNotification_id_messageId_key" ON "UserNotification"("id", "messageId");

-- CreateIndex
CREATE INDEX "PushDelivery_status_nextAttemptAt_leaseUntil_idx" ON "PushDelivery"("status", "nextAttemptAt", "leaseUntil");

-- CreateIndex
CREATE INDEX "PushDelivery_messageId_status_idx" ON "PushDelivery"("messageId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PushDelivery_userNotificationId_deviceId_key" ON "PushDelivery"("userNotificationId", "deviceId");

-- AddForeignKey
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_clientId_userId_fkey" FOREIGN KEY ("clientId", "userId") REFERENCES "User"("clientId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationMessage" ADD CONSTRAINT "NotificationMessage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationMessage" ADD CONSTRAINT "NotificationMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_clientId_userId_fkey" FOREIGN KEY ("clientId", "userId") REFERENCES "User"("clientId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_clientId_messageId_fkey" FOREIGN KEY ("clientId", "messageId") REFERENCES "NotificationMessage"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "NotificationMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_userNotificationId_messageId_fkey" FOREIGN KEY ("userNotificationId", "messageId") REFERENCES "UserNotification"("id", "messageId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PushDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A token is bound to one active app installation at a time, including account switches.
CREATE UNIQUE INDEX "one_active_push_token" ON "PushDevice" ("tokenHash") WHERE "isActive";
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_values_check" CHECK (
  "appCode" IN ('RIDER_APP','FLEET_MANAGER_APP') AND platform IN ('ANDROID','IOS')
  AND length(token) > 0 AND version >= 1);
ALTER TABLE "NotificationMessage" ADD CONSTRAINT "NotificationMessage_values_check" CHECK (
  btrim(title) <> '' AND btrim(body) <> '' AND "totalUsers" >= 0
  AND "pushExpiresAt" > "createdAt"
  AND status IN ('QUEUED','PROCESSING','WAITING_FOR_CONFIGURATION','COMPLETED','PARTIAL','FAILED')
  AND audience IN ('ALL_USERS','ALL_RIDERS','ALL_FLEET_MANAGERS','PHONE_NUMBERS','USER_IDS')
  AND jsonb_typeof(data) = 'object');
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_values_check" CHECK (
  status IN ('PENDING','PROCESSING','RETRY','ACCEPTED','FAILED','SKIPPED') AND attempts >= 0 AND "deviceVersion" >= 1
  AND (status <> 'PROCESSING' OR ("claimId" IS NOT NULL AND "leaseUntil" IS NOT NULL))
  AND (status <> 'ACCEPTED' OR "acceptedAt" IS NOT NULL));
CREATE FUNCTION guard_notification_message_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','completedAt','senderId']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','completedAt','senderId']) THEN
    RAISE EXCEPTION 'Queued notification content and audience are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notification_message_content_guard BEFORE UPDATE ON "NotificationMessage" FOR EACH ROW EXECUTE FUNCTION guard_notification_message_content();

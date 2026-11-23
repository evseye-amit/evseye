ALTER TABLE "NotificationMessage" ADD COLUMN "scheduledFor" TIMESTAMP(3);
CREATE INDEX "NotificationMessage_status_scheduledFor_idx" ON "NotificationMessage"(status,"scheduledFor");
ALTER TABLE "NotificationMessage" ADD CONSTRAINT "NotificationMessage_schedule_check"
  CHECK ("scheduledFor" IS NULL OR ("scheduledFor">"createdAt" AND "pushExpiresAt">"scheduledFor" AND ("visibilityExpiresAt" IS NULL OR "visibilityExpiresAt">"scheduledFor")));
-- The existing content guard automatically makes scheduledFor immutable.

-- Project-scoped delivery selection joins installations through their binding.
CREATE INDEX "PushDevice_notificationAppBindingId_idx" ON "PushDevice"("notificationAppBindingId");

-- Keep one open commercial subscription per client. This closes the race where
-- two package-selection requests could both create PENDING/ACTIVE subscriptions.
CREATE UNIQUE INDEX IF NOT EXISTS "ClientSubscription_one_open_per_client"
ON "ClientSubscription" ("clientId")
WHERE "status" IN ('PENDING', 'ACTIVE');

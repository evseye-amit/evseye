CREATE UNIQUE INDEX "User_client_normalized_mobile_key"
ON "User" (
  "clientId",
  right(regexp_replace("mobile", '[^0-9]', '', 'g'), 10)
)
WHERE "deletedAt" IS NULL
  AND "clientId" IS NOT NULL;
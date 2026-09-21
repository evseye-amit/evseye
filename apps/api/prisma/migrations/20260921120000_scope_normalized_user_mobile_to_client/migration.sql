-- A mobile number may be used by different clients, but only once within a
-- client regardless of role, country-code prefix, or leading zero.
DROP INDEX IF EXISTS "User_normalized_mobile_global_key";

CREATE UNIQUE INDEX "User_client_normalized_mobile_key"
ON "User" ("clientId", right(regexp_replace("mobile", '[^0-9]', '', 'g'), 10))
WHERE "deletedAt" IS NULL AND "clientId" IS NOT NULL;

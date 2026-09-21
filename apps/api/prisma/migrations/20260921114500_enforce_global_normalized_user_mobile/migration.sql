-- Enforce one non-deleted user per Indian mobile number regardless of
-- client, role, country-code prefix, or leading zero.
CREATE UNIQUE INDEX "User_normalized_mobile_global_key"
ON "User" (right(regexp_replace("mobile", '[^0-9]', '', 'g'), 10))
WHERE "deletedAt" IS NULL;

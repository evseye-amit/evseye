INSERT INTO "FeatureStep" ("id", "code", "displayName", "description", "parentId", "displayOrder", "isActive", "createdAt", "updatedAt")
SELECT 'aab80609-5049-49bf-8630-40c74243d06c', 'LOGIN_IDENTIFIER', 'Identify account', 'Collect the account identifier before verification.', "id", 1, true, now(), now()
FROM "FeatureStep" WHERE "code" = 'LOGIN'
ON CONFLICT ("code") DO NOTHING;

UPDATE "Feature" SET "code" = 'CAPTURE_LOGIN_OTP' WHERE "code" = 'CAPTRUE_LOGIN_OTP';
UPDATE "Feature" SET "code" = 'SEND_OTP_VIA_SMS' WHERE "code" = 'SMS_LOGIN_OTP';
UPDATE "Feature" SET "code" = 'SEND_OTP_VIA_EMAIL' WHERE "code" = 'EMAIL_LOGIN_OTP';

INSERT INTO "FeatureStep" ("id", "code", "displayName", "description", "parentId", "displayOrder", "isActive", "createdAt", "updatedAt")
SELECT '53a1197c-87a1-4c22-ba0a-8d176e9411d2', 'LOGIN_VERIFICATION', 'Verify account', 'Verify the account using an enabled login method.', "id", 2, true, now(), now()
FROM "FeatureStep" WHERE "code" = 'LOGIN'
ON CONFLICT ("code") DO NOTHING;

UPDATE "Feature" SET "featureStepId" = (SELECT "id" FROM "FeatureStep" WHERE "code" = 'LOGIN_IDENTIFIER')
WHERE "code" IN ('CAPTURE_MOBILE_NUMBER', 'CAPTURE_EMAIL');

UPDATE "Feature" SET "featureStepId" = (SELECT "id" FROM "FeatureStep" WHERE "code" = 'LOGIN_VERIFICATION')
WHERE "code" IN ('CAPTURE_LOGIN_OTP', 'SEND_OTP_VIA_SMS', 'SEND_OTP_VIA_EMAIL');

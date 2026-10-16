ALTER TABLE "AppLegalDocument" ALTER COLUMN "publishedAt" DROP NOT NULL;
ALTER TABLE "AppLegalDocument" ALTER COLUMN "publishedAt" DROP DEFAULT;
ALTER TABLE "AppLegalDocument" ADD COLUMN "deletedAt" TIMESTAMP(3);

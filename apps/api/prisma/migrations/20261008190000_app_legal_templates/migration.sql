CREATE TABLE "AppLegalTemplate" (
    "id" TEXT NOT NULL,
    "appCode" VARCHAR(40) NOT NULL,
    "role" "UserRole" NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "locale" VARCHAR(10) NOT NULL,
    "version" VARCHAR(80) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppLegalTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppLegalTemplate_appCode_role_kind_locale_version_key" ON "AppLegalTemplate"("appCode", "role", "kind", "locale", "version");
CREATE INDEX "AppLegalTemplate_isActive_deletedAt_idx" ON "AppLegalTemplate"("isActive", "deletedAt");

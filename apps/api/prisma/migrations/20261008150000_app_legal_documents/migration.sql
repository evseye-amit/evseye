CREATE TABLE "AppLegalDocument" (
  "id" TEXT NOT NULL,
  "clientId" TEXT,
  "appCode" VARCHAR(40) NOT NULL,
  "role" "UserRole" NOT NULL,
  "kind" VARCHAR(40) NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "version" VARCHAR(80) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "content" TEXT NOT NULL,
  "contentHash" CHAR(64) NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppLegalDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppLegalDocument_clientId_appCode_role_kind_locale_version_key" ON "AppLegalDocument"("clientId", "appCode", "role", "kind", "locale", "version");
CREATE UNIQUE INDEX "AppLegalDocument_global_version_key" ON "AppLegalDocument"("appCode", "role", "kind", "locale", "version") WHERE "clientId" IS NULL;
CREATE INDEX "AppLegalDocument_clientId_appCode_role_kind_locale_effectiveAt_idx" ON "AppLegalDocument"("clientId", "appCode", "role", "kind", "locale", "effectiveAt");
ALTER TABLE "AppLegalDocument" ADD CONSTRAINT "AppLegalDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AppLegalAcceptance" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "deviceId" VARCHAR(128),
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deviceAcceptedAt" TIMESTAMP(3),
  "contentHash" CHAR(64) NOT NULL,
  CONSTRAINT "AppLegalAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppLegalAcceptance_userId_documentId_key" ON "AppLegalAcceptance"("userId", "documentId");
CREATE INDEX "AppLegalAcceptance_clientId_userId_acceptedAt_idx" ON "AppLegalAcceptance"("clientId", "userId", "acceptedAt");
ALTER TABLE "AppLegalAcceptance" ADD CONSTRAINT "AppLegalAcceptance_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AppLegalAcceptance" ADD CONSTRAINT "AppLegalAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AppLegalAcceptance" ADD CONSTRAINT "AppLegalAcceptance_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "AppLegalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

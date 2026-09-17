CREATE TYPE "ClientDomainType" AS ENUM ('EVSEYE_SUBDOMAIN', 'CUSTOM_DOMAIN');
CREATE TABLE "ClientDomain" (
  "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "hostname" TEXT NOT NULL,
  "type" "ClientDomainType" NOT NULL, "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "isVerified" BOOLEAN NOT NULL DEFAULT false, "verificationToken" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientDomain_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClientDomain_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClientDomain_hostname_normalized" CHECK ("hostname" = lower("hostname") AND length("hostname") <= 253 AND "hostname" ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$')
);
CREATE UNIQUE INDEX "ClientDomain_hostname_key" ON "ClientDomain"("hostname");
CREATE INDEX "ClientDomain_clientId_idx" ON "ClientDomain"("clientId");
CREATE UNIQUE INDEX "ClientDomain_one_primary" ON "ClientDomain"("clientId") WHERE "isPrimary";
CREATE TABLE "ClientBranding" (
  "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "logoObjectKey" TEXT, "faviconObjectKey" TEXT,
  "primaryColor" TEXT NOT NULL DEFAULT '#176b4c', "secondaryColor" TEXT NOT NULL DEFAULT '#e4f2e9', "accentColor" TEXT NOT NULL DEFAULT '#27865f',
  "loginTitle" TEXT NOT NULL DEFAULT 'Welcome back', "loginSubtitle" TEXT NOT NULL DEFAULT 'Sign in to your EV fleet workspace.',
  "supportEmail" TEXT, "supportPhone" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientBranding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClientBranding_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ClientBranding_clientId_key" ON "ClientBranding"("clientId");
-- Preserve all existing client IDs, slugs, login codes and uploaded logos.
INSERT INTO "ClientBranding" ("id", "clientId", "logoObjectKey", "updatedAt")
SELECT c."id", c."id", b."logoObjectKey", CURRENT_TIMESTAMP FROM "Client" c LEFT JOIN "ClientBusinessProfile" b ON b."clientId" = c."id";
-- Domains depend on runtime base-domain configuration; no production hostname is guessed here.

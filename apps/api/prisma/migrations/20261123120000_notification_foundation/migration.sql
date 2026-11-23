-- AlterTable
ALTER TABLE "PushDevice" ADD COLUMN     "notificationAppBindingId" TEXT;

-- AlterTable
ALTER TABLE "NotificationMessage" ADD COLUMN     "categoryCode" TEXT;

-- CreateTable
CREATE TABLE "NotificationParentGroup" (
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationParentGroup_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "NotificationCategory" (
    "code" VARCHAR(100) NOT NULL,
    "parentCode" VARCHAR(10) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "defaultPriority" VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    "defaultDelivery" VARCHAR(30) NOT NULL DEFAULT 'TOKEN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationCategory_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "NotificationApplicationCategory" (
    "categoryCode" VARCHAR(100) NOT NULL,
    "application" VARCHAR(30) NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationApplicationCategory_pkey" PRIMARY KEY ("categoryCode","application")
);

-- CreateTable
CREATE TABLE "FirebaseProjectConfiguration" (
    "id" TEXT NOT NULL,
    "projectId" VARCHAR(150) NOT NULL,
    "environment" VARCHAR(40) NOT NULL,
    "credentialReference" VARCHAR(150) NOT NULL,
    "credentialVersion" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FirebaseProjectConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationAppBinding" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "appCode" VARCHAR(40) NOT NULL,
    "platform" VARCHAR(10) NOT NULL,
    "applicationId" VARCHAR(255) NOT NULL,
    "environment" VARCHAR(40) NOT NULL,
    "firebaseConfigurationId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationAppBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationCategory_parentCode_isActive_idx" ON "NotificationCategory"("parentCode", "isActive");

-- CreateIndex
CREATE INDEX "NotificationApplicationCategory_application_allowed_idx" ON "NotificationApplicationCategory"("application", "allowed");

-- CreateIndex
CREATE UNIQUE INDEX "FirebaseProjectConfiguration_environment_projectId_key" ON "FirebaseProjectConfiguration"("environment", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "FirebaseProjectConfiguration_id_environment_key" ON "FirebaseProjectConfiguration"("id", "environment");

-- CreateIndex
CREATE INDEX "NotificationAppBinding_firebaseConfigurationId_idx" ON "NotificationAppBinding"("firebaseConfigurationId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationAppBinding_clientId_id_key" ON "NotificationAppBinding"("clientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationAppBinding_clientId_appCode_platform_applicatio_key" ON "NotificationAppBinding"("clientId", "appCode", "platform", "applicationId", "environment");

-- AddForeignKey
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_clientId_notificationAppBindingId_fkey" FOREIGN KEY ("clientId", "notificationAppBindingId") REFERENCES "NotificationAppBinding"("clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationMessage" ADD CONSTRAINT "NotificationMessage_categoryCode_fkey" FOREIGN KEY ("categoryCode") REFERENCES "NotificationCategory"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationCategory" ADD CONSTRAINT "NotificationCategory_parentCode_fkey" FOREIGN KEY ("parentCode") REFERENCES "NotificationParentGroup"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationApplicationCategory" ADD CONSTRAINT "NotificationApplicationCategory_categoryCode_fkey" FOREIGN KEY ("categoryCode") REFERENCES "NotificationCategory"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationAppBinding" ADD CONSTRAINT "NotificationAppBinding_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationAppBinding" ADD CONSTRAINT "NotificationAppBinding_firebaseConfigurationId_environment_fkey" FOREIGN KEY ("firebaseConfigurationId", "environment") REFERENCES "FirebaseProjectConfiguration"("id", "environment") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Catalog values are bounded independently of API validation.
ALTER TABLE "NotificationCategory"
  ADD CONSTRAINT "NotificationCategory_priority_check" CHECK ("defaultPriority" IN ('NORMAL', 'HIGH')),
  ADD CONSTRAINT "NotificationCategory_delivery_check" CHECK ("defaultDelivery" IN ('TOKEN', 'TOPIC_ELIGIBLE'));
ALTER TABLE "NotificationApplicationCategory"
  ADD CONSTRAINT "NotificationApplicationCategory_application_check" CHECK (application IN ('RIDER', 'FLEET_MANAGER', 'TEAM_LEADER', 'ADMIN'));
ALTER TABLE "FirebaseProjectConfiguration"
  ADD CONSTRAINT "FirebaseProjectConfiguration_version_check" CHECK ("credentialVersion" > 0),
  ADD CONSTRAINT "FirebaseProjectConfiguration_reference_check" CHECK ("credentialReference" ~ '^[A-Z][A-Z0-9_]{0,149}$');

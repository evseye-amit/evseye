CREATE TABLE "TrainingContent" (
  "id" TEXT NOT NULL,
  "featureId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "imageObjectKey" VARCHAR(500) NOT NULL,
  "isMandatory" BOOLEAN NOT NULL DEFAULT true,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrainingContent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrainingContent_code_key" ON "TrainingContent"("code");
CREATE INDEX "TrainingContent_featureId_isActive_displayOrder_idx"
  ON "TrainingContent"("featureId", "isActive", "displayOrder");
ALTER TABLE "TrainingContent"
  ADD CONSTRAINT "TrainingContent_featureId_fkey"
  FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MobileDeploymentWorkflow"
  ADD COLUMN "trainingViewedContentCodes" JSONB NOT NULL DEFAULT '[]';

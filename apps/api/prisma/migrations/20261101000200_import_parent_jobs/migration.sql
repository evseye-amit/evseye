ALTER TABLE "ImportJob" ADD COLUMN "parentJobId" TEXT;
CREATE INDEX "ImportJob_parentJobId_idx" ON "ImportJob"("parentJobId");
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_parentJobId_fkey" FOREIGN KEY ("parentJobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

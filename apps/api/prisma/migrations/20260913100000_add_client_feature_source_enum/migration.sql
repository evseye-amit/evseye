CREATE TYPE "ClientFeatureSource" AS ENUM (
  'PACKAGE',
  'ADD_ON',
  'CUSTOM',
  'PROMOTIONAL'
);

ALTER TABLE "ClientFeature"
  ALTER COLUMN "source" DROP DEFAULT,
  ALTER COLUMN "source" TYPE "ClientFeatureSource" USING "source"::"ClientFeatureSource",
  ALTER COLUMN "source" SET DEFAULT 'ADD_ON';

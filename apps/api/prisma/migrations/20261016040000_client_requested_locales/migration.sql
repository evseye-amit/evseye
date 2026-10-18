ALTER TABLE "Client" ADD COLUMN "requestedLocales" TEXT[] NOT NULL DEFAULT ARRAY['en']::TEXT[];

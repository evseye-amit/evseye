-- Catalog codes are permanent identifiers used by imports, fleets and integrations.
-- The existing unique constraints reject duplicate codes in each catalog.
ALTER TABLE "Oem" ADD CONSTRAINT "Oem_code_canonical_check" CHECK ("code" ~ '^[A-Z0-9_-]{1,40}$');
ALTER TABLE "VehicleCategory" ADD CONSTRAINT "VehicleCategory_code_canonical_check" CHECK ("code" ~ '^[A-Z0-9_-]{1,50}$');
ALTER TABLE "VehicleType" ADD CONSTRAINT "VehicleType_code_canonical_check" CHECK ("code" ~ '^[A-Z0-9_-]{1,50}$');

CREATE FUNCTION prevent_vehicle_catalog_code_change() RETURNS trigger AS $$
BEGIN
  IF NEW."code" IS DISTINCT FROM OLD."code" THEN
    RAISE EXCEPTION 'Catalog code cannot be changed after creation.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Oem_code_immutable" BEFORE UPDATE OF "code" ON "Oem"
  FOR EACH ROW EXECUTE FUNCTION prevent_vehicle_catalog_code_change();
CREATE TRIGGER "VehicleCategory_code_immutable" BEFORE UPDATE OF "code" ON "VehicleCategory"
  FOR EACH ROW EXECUTE FUNCTION prevent_vehicle_catalog_code_change();
CREATE TRIGGER "VehicleType_code_immutable" BEFORE UPDATE OF "code" ON "VehicleType"
  FOR EACH ROW EXECUTE FUNCTION prevent_vehicle_catalog_code_change();

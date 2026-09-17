-- Existing accounts are untouched. New or reassigned mobile numbers must be
-- unique across clients and roles, including legacy Indian number formats.
CREATE FUNCTION user_mobile_identity(value TEXT) RETURNS TEXT
LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE
    WHEN regexp_replace(value, '[^0-9]', '', 'g') ~ '^(0|91)?[6-9][0-9]{9}$'
      THEN '+91' || right(regexp_replace(value, '[^0-9]', '', 'g'), 10)
    ELSE btrim(value)
  END;
$$;

CREATE FUNCTION reject_duplicate_user_mobile() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  canonical TEXT;
BEGIN
  IF NEW."deletedAt" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  canonical := user_mobile_identity(NEW.mobile);
  -- Existing legacy collisions remain reviewable; unrelated edits do not
  -- silently disable either account.
  IF TG_OP = 'UPDATE' THEN
    IF OLD."deletedAt" IS NULL AND user_mobile_identity(OLD.mobile) = canonical THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Serialize concurrent writes for the same number before checking ownership.
  PERFORM pg_advisory_xact_lock(hashtextextended(canonical, 0));
  IF EXISTS (
    SELECT 1 FROM "User" AS other
    WHERE other.id IS DISTINCT FROM NEW.id
      AND other."deletedAt" IS NULL
      AND user_mobile_identity(other.mobile) = canonical
  ) THEN
    RAISE unique_violation USING
      CONSTRAINT = 'User_mobile_canonical_current_key',
      MESSAGE = 'This mobile number is already assigned to another user or role.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "User_reject_duplicate_mobile"
BEFORE INSERT OR UPDATE OF mobile, "deletedAt" ON "User"
FOR EACH ROW EXECUTE FUNCTION reject_duplicate_user_mobile();

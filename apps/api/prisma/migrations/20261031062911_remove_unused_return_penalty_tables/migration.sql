BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE "ReturnPenaltyCase", "ReturnPenaltyItem" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ReturnPenaltyCase")
    OR EXISTS (SELECT 1 FROM "ReturnPenaltyItem") THEN
    RAISE EXCEPTION 'Refusing to drop populated return penalty tables.';
  END IF;
END;
$$;

DROP TABLE "ReturnPenaltyItem";
DROP TABLE "ReturnPenaltyCase";

COMMIT;

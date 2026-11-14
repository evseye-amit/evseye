-- The consolidated baseline omitted sequences used by commercial lifecycle code.
-- Keep existing sequences untouched; initialize missing ones above issued numbers.
BEGIN;
LOCK TABLE "RiderCommercialOffer", "RiderRentalAgreement" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF to_regclass('public.rider_commercial_offer_number_seq') IS NULL THEN
    CREATE SEQUENCE public.rider_commercial_offer_number_seq;
    PERFORM setval('public.rider_commercial_offer_number_seq',
      COALESCE((SELECT MAX(substring("offerNumber" FROM '^EVO-[0-9]{4}-([0-9]+)$')::bigint)
        FROM "RiderCommercialOffer"), 0) + 1, false);
  END IF;
  IF to_regclass('public.rider_rental_agreement_number_seq') IS NULL THEN
    CREATE SEQUENCE public.rider_rental_agreement_number_seq;
    PERFORM setval('public.rider_rental_agreement_number_seq',
      COALESCE((SELECT MAX(substring("agreementNumber" FROM '^EVRA-[0-9]{4}-([0-9]+)$')::bigint)
        FROM "RiderRentalAgreement"), 0) + 1, false);
  END IF;
END $$;
COMMIT;

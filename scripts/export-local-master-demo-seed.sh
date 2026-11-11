#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Only reusable master data and the intentional local demo tenant belong in a seed.
# Keep authentication, audit, payment, KYC result, usage, and uploaded-media rows out.
tables=(
  AppLegalDocument AppLegalTemplate Battery Client ClientAddress ClientAgreement
  ClientBillingProfile ClientBranding ClientBusinessProfile ClientContact
  ClientOnboardingProgress ClientOnboardingStepRecord ClientOperationsProfile
  ClientOperationsVehicleCategory ClientSubscription Controller
  Feature FeaturePricing FeatureRevision FeatureStep Fleet FleetBatteryHistory
  FleetControllerHistory FleetFitness FleetInsurance FleetRegistration Hub IoTDevice
  KycDecisionRule KycIntelligentRoutingControl KycProviderCapability
  KycProviderConfig KycRoutingPolicy KycRoutingProvider KycWorkflowDefinition
  KycWorkflowStep Oem Package PackageFeature PackageRevision
  PackageVehicleTierPricing ReferralCampaign ReferralCampaignMilestone
  TeamLeaderProfile User UserHub VehicleCategory VehicleType
)

output=apps/api/prisma/local-master-demo-seed.sql
tmp=$(mktemp "${output}.XXXXXX")
trap 'rm -f "$tmp"' EXIT

{
  printf '%s\n' '-- Local master/demo seed snapshot. Regenerate with scripts/export-local-master-demo-seed.sh.'
  printf '%s\n' '-- Apply only to a freshly migrated, empty local database.'
  printf '%s\n' '-- Local-only ClientPreLoginConfig and Client.requestedLocales are excluded'
  printf '%s\n' '-- because they are absent from the checked-in schema.'
  printf '%s\n' 'BEGIN;'
  printf '%s\n' 'DO $$ BEGIN'
  printf '%s\n' '  IF EXISTS (SELECT 1 FROM public."Client") OR EXISTS (SELECT 1 FROM public."Feature") OR EXISTS (SELECT 1 FROM public."Oem") THEN'
  printf '%s\n' "    RAISE EXCEPTION 'Seed snapshot requires a freshly migrated, empty database';"
  printf '%s\n' '  END IF;'
  printf '%s\n' 'END $$;'
  printf '%s\n' 'SET LOCAL session_replication_role = replica;'
  for table in "${tables[@]}"; do
    columns=$(docker compose exec -T postgres psql -U evseye -d evseye -At -c "
      SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '$table'
        AND NOT (table_name = 'Client' AND column_name = 'requestedLocales')")
    if [[ -z "$columns" ]]; then
      printf 'No compatible columns found for %s\n' "$table" >&2
      exit 1
    fi
    printf '\nDELETE FROM public."%s";\n' "$table"
    printf 'COPY public."%s" (%s) FROM STDIN WITH CSV;\n' "$table" "$columns"
    docker compose exec -T postgres psql -U evseye -d evseye -qAt -c \
      "COPY (SELECT $columns FROM public.\"$table\" ORDER BY 1) TO STDOUT WITH CSV"
    printf '%s\n' '\.'
  done
  printf '%s\n' 'COMMIT;'
} > "$tmp"
mv "$tmp" "$output"
printf 'Exported %s tables to %s\n' "${#tables[@]}" "$output"

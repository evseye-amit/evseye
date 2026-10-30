-- Keep the existing preparation-photo immutability guard after the baseline
-- removes the legacy Photo.entityType discriminator.
CREATE OR REPLACE FUNCTION public.freeze_preparation_photo() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD."workFlowType"::text='FLEET_PREPARATION' AND (
    EXISTS (SELECT 1 FROM "FleetPreparationRevision" r WHERE r.id=OLD."entityId" AND r."submittedAt" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM "FleetInstallationStage" s WHERE OLD."entityId"='installation:'||s.id||':'||s.revision::text AND s."submittedAt" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM "FleetInstallationStage" s, jsonb_array_elements(s.history) h WHERE h->'photoIds' ? OLD.id)
  ) THEN RAISE EXCEPTION 'Submitted preparation photos are immutable.'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.invalidate_installation_component(fleet_id text, component_kind text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE stage_id TEXT; prep_id TEXT;
BEGIN
  FOR prep_id IN SELECT id FROM "FleetPreparation" WHERE "fleetId"=fleet_id AND status IN ('PENDING','IN_PROGRESS','REWORK_REQUIRED') AND "policySnapshot"->>'operatingMode'='STAGED_PREPARATION_QC' LOOP
    FOR stage_id IN
      WITH RECURSIVE affected AS (
        SELECT id,code FROM "FleetInstallationStage" WHERE "preparationId"=prep_id AND definition->>'component'=component_kind
        UNION
        SELECT s.id,s.code FROM "FleetInstallationStage" s JOIN affected a ON s.definition->'dependencies' ? a.code WHERE s."preparationId"=prep_id
      ) SELECT id FROM affected
    LOOP
      UPDATE "FleetInstallationStage" SET status='WAITING',revision=revision+1,checklist='{}',"componentSnapshot"=NULL,"submittedAt"=NULL,"submittedById"=NULL,"reviewedAt"=NULL,"reviewedById"=NULL,reason='Installed component changed; reconfirm stage.',"failedItems"=ARRAY[]::TEXT[],"updatedAt"=CURRENT_TIMESTAMP WHERE id=stage_id;
    END LOOP;
    IF EXISTS (SELECT 1 FROM "FleetPreparationRevision" r JOIN "FleetPreparation" p ON r."preparationId"=p.id AND r.revision=p."currentRevision" WHERE p.id=prep_id AND (r.checklist<>'{}'::jsonb OR EXISTS (SELECT 1 FROM "Photo" ph WHERE ph."entityId"=r.id AND ph."workFlowType"::text='FLEET_PREPARATION'))) THEN
      UPDATE "FleetPreparation" SET "currentRevision"="currentRevision"+1 WHERE id=prep_id;
      INSERT INTO "FleetPreparationRevision" (id,"clientId","preparationId",revision) SELECT gen_random_uuid()::text,"clientId",id,"currentRevision" FROM "FleetPreparation" WHERE id=prep_id;
    END IF;
    INSERT INTO "FleetPreparationEvent" (id,"clientId","preparationId",action,data,"createdAt") SELECT gen_random_uuid()::text,"clientId",id,'INSTALLATION_INVALIDATED',jsonb_build_object('component',component_kind),CURRENT_TIMESTAMP FROM "FleetPreparation" WHERE id=prep_id;
  END LOOP;
END $$;

-- PostgreSQL behavior not represented by Prisma's schema: checks, indexes,
-- functions, and triggers recovered from the current database schema.
-- Apply after the schema baseline.
-- Keep the fleet manager history coverage boundary initialized on fresh databases.
INSERT INTO "FleetManagerHomeHistoryCoverage" ("id", "availableFrom")
VALUES ('initial', clock_timestamp())
ON CONFLICT ("id") DO NOTHING;

CREATE FUNCTION public.collection_audit_event() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "AuditLog" ("clientId", "actorId", "action", "entityType", "entityId", "newData")
  VALUES (NEW."clientId", NEW."actorId", NEW."eventType", 'RiderCollectionCase', NEW."caseId", NEW."details");
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.collection_enqueue_invoice_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "CollectionEvaluationQueue" ("id", "clientId", "riderId", "requestedAt")
  VALUES (gen_random_uuid()::text, NEW."clientId", NEW."riderId", CURRENT_TIMESTAMP)
  ON CONFLICT ("clientId", "riderId") DO UPDATE SET "requestedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.enforce_allocation_readiness() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE prep_mode BOOLEAN; approved TEXT; disabled BOOLEAN;
BEGIN
  IF TG_OP='UPDATE' AND NOT (NEW.status='ACTIVE' AND OLD.status IS DISTINCT FROM NEW.status) THEN RETURN NEW; END IF;
  IF NEW.status IN ('COMPLETED','CANCELLED') THEN RETURN NEW; END IF;
  SELECT f."readinessWorkflow"::text IN ('PREPARATION_QC','STAGED_PREPARATION_QC'), f."readinessApprovedPreparationId",
    (NOT f."allocationEnabled" OR f."allocationBlockedByAdmin")
    INTO prep_mode, approved, disabled
    FROM "Fleet" f WHERE f.id=NEW."fleetId" AND f."clientId"=NEW."clientId" FOR UPDATE;
  IF disabled THEN RAISE EXCEPTION 'FLEET_ALLOCATION_BLOCKED: Allocation is administratively disabled.' USING ERRCODE='P0001'; END IF;
  IF prep_mode AND approved IS NULL THEN RAISE EXCEPTION 'PREPARATION_QC_REQUIRED: Scooter requires current preparation and QC approval.' USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.enforce_fleet_readiness() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE prep_mode BOOLEAN; invalidated BOOLEAN := FALSE;
BEGIN
  prep_mode := NEW."readinessWorkflow"::text IN ('PREPARATION_QC','STAGED_PREPARATION_QC');
  IF TG_OP='UPDATE' THEN
    invalidated := OLD."currentHubId" IS DISTINCT FROM NEW."currentHubId" OR OLD."iotDeviceId" IS DISTINCT FROM NEW."iotDeviceId"
      OR (NEW.status IN ('MAINTENANCE','OUT_OF_SERVICE') AND OLD.status IS DISTINCT FROM NEW.status)
      OR (OLD.status IN ('ALLOCATED','IN_USE','DEALLOCATION_IN_PROGRESS') AND NEW.status NOT IN ('ALLOCATED','IN_USE','DEALLOCATION_IN_PROGRESS'));
    -- A real, recorded receipt in this transaction is the one permitted hub
    -- move that retains an approved preparation. The application marks the
    -- transfer with a transaction-local GUC before updating Fleet. Matching
    -- older RECEIVED rows must not exempt manual hub edits.
    IF OLD."currentHubId" IS DISTINCT FROM NEW."currentHubId" AND EXISTS (
      SELECT 1 FROM "FleetTransfer" t
      WHERE t.id = NULLIF(current_setting('evseye.fleet_transfer_receipt_id', true), '')
        AND t."fleetId"=NEW.id AND t.status='RECEIVED'
        AND t."toHubId"=NEW."currentHubId" AND t."receivedAt" IS NOT NULL
        AND t."fromHubId"=OLD."currentHubId"
    ) THEN
      invalidated := OLD."iotDeviceId" IS DISTINCT FROM NEW."iotDeviceId"
        OR (NEW.status IN ('MAINTENANCE','OUT_OF_SERVICE') AND OLD.status IS DISTINCT FROM NEW.status)
        OR (OLD.status IN ('ALLOCATED','IN_USE','DEALLOCATION_IN_PROGRESS') AND NEW.status NOT IN ('ALLOCATED','IN_USE','DEALLOCATION_IN_PROGRESS'));
    END IF;
    -- Preserve staged installation's IoT binding exception from the prior trigger.
    IF OLD."iotDeviceId" IS DISTINCT FROM NEW."iotDeviceId"
      AND OLD."currentHubId" IS NOT DISTINCT FROM NEW."currentHubId"
      AND OLD.status IS NOT DISTINCT FROM NEW.status
      AND EXISTS (SELECT 1 FROM "FleetPreparation" p WHERE p."fleetId"=NEW.id AND p.status='IN_PROGRESS' AND p."policySnapshot"->>'operatingMode'='STAGED_PREPARATION_QC')
    THEN invalidated:=FALSE; END IF;
    IF invalidated THEN
      NEW."readinessApprovedPreparationId" := NULL;
      INSERT INTO "FleetPreparationEvent" (id,"clientId","preparationId",action,data,"createdAt")
        SELECT gen_random_uuid()::text,"clientId",id,'INVALIDATED','{"reason":"Hub, component, maintenance or return changed readiness."}'::jsonb,CURRENT_TIMESTAMP
        FROM "FleetPreparation" WHERE "fleetId"=NEW.id AND status NOT IN ('INVALIDATED','CANCELLED');
      UPDATE "FleetPreparation" SET status='INVALIDATED',"invalidationReason"='Hub, component, maintenance or return changed readiness.',"updatedAt"=CURRENT_TIMESTAMP
        WHERE "fleetId"=NEW.id AND status NOT IN ('INVALIDATED','CANCELLED');
    END IF;
  END IF;
  IF NEW."readinessApprovedPreparationId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "FleetPreparation" p WHERE p.id=NEW."readinessApprovedPreparationId" AND p."clientId"=NEW."clientId" AND p."fleetId"=NEW.id
      AND (p."hubId"=NEW."currentHubId" OR EXISTS (
        SELECT 1 FROM "FleetTransfer" t WHERE t."fleetId"=NEW.id AND t.status='RECEIVED'
          AND t.id = NULLIF(current_setting('evseye.fleet_transfer_receipt_id', true), '')
          AND t."toHubId"=NEW."currentHubId" AND t."fromHubId"=p."hubId" AND t."receivedAt" IS NOT NULL
      )) AND p.status='APPROVED'
  ) THEN NEW."readinessApprovedPreparationId" := NULL; END IF;
  IF prep_mode AND NEW."allocationBlockedByAdmin" THEN NEW."allocationEnabled":=false; END IF;
  IF prep_mode AND NEW.status='AVAILABLE' AND NEW."readinessApprovedPreparationId" IS NULL THEN NEW.status:='INSPECTION_PENDING'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.freeze_installation_evidence() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW."clientId" IS DISTINCT FROM OLD."clientId" OR NEW."preparationId" IS DISTINCT FROM OLD."preparationId" OR NEW.code IS DISTINCT FROM OLD.code OR NEW.definition IS DISTINCT FROM OLD.definition THEN RAISE EXCEPTION 'Installation identity and policy are immutable.'; END IF;
  IF jsonb_array_length(NEW.history)<jsonb_array_length(OLD.history) OR EXISTS (SELECT 1 FROM jsonb_array_elements(OLD.history) WITH ORDINALITY x(value,n) WHERE NEW.history->((x.n-1)::int) IS DISTINCT FROM x.value) THEN RAISE EXCEPTION 'Installation history is append only.'; END IF;
  IF OLD."submittedAt" IS NOT NULL AND NEW.revision=OLD.revision AND (NEW.checklist IS DISTINCT FROM OLD.checklist OR NEW."componentSnapshot" IS DISTINCT FROM OLD."componentSnapshot" OR NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt" OR NEW."submittedById" IS DISTINCT FROM OLD."submittedById") THEN RAISE EXCEPTION 'Submitted installation evidence is immutable.'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.freeze_preparation_photo() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD."entityType"::text='PREPARATION' AND (
    EXISTS (SELECT 1 FROM "FleetPreparationRevision" r WHERE r.id=OLD."entityId" AND r."submittedAt" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM "FleetInstallationStage" s WHERE OLD."entityId"='installation:'||s.id||':'||s.revision::text AND s."submittedAt" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM "FleetInstallationStage" s, jsonb_array_elements(s.history) h WHERE h->'photoIds' ? OLD.id)
  ) THEN RAISE EXCEPTION 'Submitted preparation photos are immutable.'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.freeze_preparation_revision() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD."submittedAt" IS NOT NULL AND (
    NEW.checklist IS DISTINCT FROM OLD.checklist OR NEW."componentSnapshot" IS DISTINCT FROM OLD."componentSnapshot"
    OR NEW."photoIds" IS DISTINCT FROM OLD."photoIds" OR NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt"
    OR NEW."submittedById" IS DISTINCT FROM OLD."submittedById" OR NEW.revision IS DISTINCT FROM OLD.revision
  ) THEN RAISE EXCEPTION 'Submitted preparation evidence is immutable.'; END IF;
  IF OLD."reviewedAt" IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Reviewed preparation revision is immutable.'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.freeze_spare_revision() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN RAISE EXCEPTION 'Spare catalogue revisions are immutable.'; END $$;

CREATE FUNCTION public.guard_notification_message_content() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','completedAt','senderId']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','completedAt','senderId']) THEN
    RAISE EXCEPTION 'Queued notification content and audience are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.guard_vehicle_mechanic_reuse() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (NEW."allocationEnabled" OR NEW.status IN ('AVAILABLE','ALLOCATED','IN_USE')) AND EXISTS (
    SELECT 1 FROM "VehicleSubmission" s WHERE s."clientId" = NEW."clientId" AND s."fleetId" = NEW.id AND NOT s."mechanicChecksComplete"
  ) THEN RAISE EXCEPTION 'Vehicle mechanic checks are pending' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.guard_vehicle_submission_allocation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status IN ('INITIATED','INSPECTION_PENDING','OTP_PENDING','ACTIVE') AND EXISTS (
    SELECT 1 FROM "VehicleSubmission" s WHERE s."clientId" = NEW."clientId" AND s."fleetId" = NEW."fleetId" AND s."allocationId" <> NEW.id AND NOT s."mechanicChecksComplete"
  ) THEN RAISE EXCEPTION 'Vehicle mechanic checks are pending' USING ERRCODE = '23514'; END IF;
  IF NEW.status = 'COMPLETED' AND (
    EXISTS (SELECT 1 FROM "RentalTerminationRequest" r WHERE r."clientId" = NEW."clientId" AND r."allocationId" = NEW.id AND r."submissionRequired" AND r.status <> 'CANCELLED') OR
    EXISTS (SELECT 1 FROM "VehicleExchangeRequest" e WHERE e."clientId" = NEW."clientId" AND e."oldAllocationId" = NEW.id AND e."submissionRequired" AND e.status NOT IN ('CANCELLED','REJECTED'))
  ) AND NOT EXISTS (SELECT 1 FROM "VehicleSubmission" s WHERE s."clientId" = NEW."clientId" AND s."allocationId" = NEW.id AND s.status = 'CONFIRMED') THEN
    RAISE EXCEPTION 'Vehicle submission confirmation is required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.guard_vehicle_submission_report() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id OR OLD."clientId" IS DISTINCT FROM NEW."clientId" OR OLD."submissionId" IS DISTINCT FROM NEW."submissionId" OR OLD."requestKey" IS DISTINCT FROM NEW."requestKey" OR OLD.stage IS DISTINCT FROM NEW.stage OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt" OR OLD."recordedById" IS DISTINCT FROM NEW."recordedById" THEN RAISE EXCEPTION 'Report identity is immutable.'; END IF;
  IF OLD."postedChargeId" IS NOT NULL AND NEW.status='CANCELLED' THEN RAISE EXCEPTION 'An imposed financial charge cannot be cancelled.'; END IF;
  IF OLD.status<>'DRAFT' OR NEW.status<>'DRAFT' THEN
  IF (to_jsonb(NEW) - ARRAY['status','imposedById','imposedAt','riderOtpRequestId','riderVerifiedUserId','teamLeadOtpRequestId','teamLeadVerifiedUserId','riderBypassReason','teamLeadBypassReason','confirmedById','confirmedAt','postedChargeId','cancelledById','cancellationReason'])
    IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','imposedById','imposedAt','riderOtpRequestId','riderVerifiedUserId','teamLeadOtpRequestId','teamLeadVerifiedUserId','riderBypassReason','teamLeadBypassReason','confirmedById','confirmedAt','postedChargeId','cancelledById','cancellationReason']) THEN
    RAISE EXCEPTION 'Mechanic report content is immutable; cancel and create a new report' USING ERRCODE = '23514';
  END IF;
  END IF;
  IF OLD.status IN ('POSTED','CANCELLED') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Completed mechanic reports are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'POSTED' AND OLD.status <> 'POSTED' THEN
    IF NEW."riderBypassReason" IS NOT NULL OR NEW."teamLeadBypassReason" IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = NEW."confirmedById" AND u."clientId" = NEW."clientId" AND u.role = 'FLEET_MANAGER' AND u."isActive" AND u."deletedAt" IS NULL) THEN
        RAISE EXCEPTION 'Only the fleet manager may bypass confirmation' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW."riderBypassReason" IS NULL AND NOT EXISTS (SELECT 1 FROM "OtpRequest" o WHERE o.id = NEW."riderOtpRequestId" AND o."clientId" = NEW."clientId" AND o.status = 'VERIFIED' AND o.purpose::text = 'HANDOVER_RIDER' AND o.context->>'reportId' = NEW.id AND o.context->>'digest' = NEW.digest AND o.context->>'recipientId' = NEW."riderVerifiedUserId") THEN
      RAISE EXCEPTION 'Rider confirmation must match this report' USING ERRCODE = '23514';
    END IF;
    IF NEW."teamLeadBypassReason" IS NULL AND NOT EXISTS (SELECT 1 FROM "OtpRequest" o WHERE o.id = NEW."teamLeadOtpRequestId" AND o."clientId" = NEW."clientId" AND o.status = 'VERIFIED' AND o.purpose::text = 'HANDOVER_OPERATOR' AND o.context->>'reportId' = NEW.id AND o.context->>'digest' = NEW.digest AND o.context->>'recipientId' = NEW."teamLeadVerifiedUserId") THEN
      RAISE EXCEPTION 'Team lead confirmation must match this report' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.installation_final_gate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status='APPROVED' AND EXISTS (SELECT 1 FROM "FleetInstallationStage" s WHERE s."preparationId"=NEW.id AND s.status<>'COMPLETED') THEN RAISE EXCEPTION 'PREPARATION_QC_REQUIRED: Complete installation stages before QC approval.'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.installation_iot_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM invalidate_installation_component(NEW.id,'IOT'); RETURN NEW;
END $$;

CREATE FUNCTION public.invalidate_fleet_readiness(fleet_id text, why text) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "FleetPreparationEvent" (id,"clientId","preparationId",action,data,"createdAt")
    SELECT gen_random_uuid()::text,"clientId",id,'INVALIDATED',jsonb_build_object('reason',why),CURRENT_TIMESTAMP
    FROM "FleetPreparation" WHERE "fleetId"=fleet_id AND status NOT IN ('INVALIDATED','CANCELLED')
    AND NOT (status IN ('PENDING','IN_PROGRESS','REWORK_REQUIRED') AND "policySnapshot"->>'operatingMode'='STAGED_PREPARATION_QC' AND why LIKE '%component%' OR status IN ('PENDING','IN_PROGRESS','REWORK_REQUIRED') AND "policySnapshot"->>'operatingMode'='STAGED_PREPARATION_QC' AND why LIKE '%identity%');
  UPDATE "FleetPreparation" SET status='INVALIDATED',"invalidationReason"=why,"updatedAt"=CURRENT_TIMESTAMP
    WHERE "fleetId"=fleet_id AND status NOT IN ('INVALIDATED','CANCELLED')
    AND NOT (status IN ('PENDING','IN_PROGRESS','REWORK_REQUIRED') AND "policySnapshot"->>'operatingMode'='STAGED_PREPARATION_QC' AND (why LIKE '%component%' OR why LIKE '%identity%'));
  UPDATE "Fleet" SET "readinessApprovedPreparationId"=NULL WHERE id=fleet_id AND "readinessApprovedPreparationId" IS NOT NULL;
END $$;

CREATE FUNCTION public.invalidate_installation_component(fleet_id text, component_kind text) RETURNS void
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
    IF EXISTS (SELECT 1 FROM "FleetPreparationRevision" r JOIN "FleetPreparation" p ON r."preparationId"=p.id AND r.revision=p."currentRevision" WHERE p.id=prep_id AND (r.checklist<>'{}'::jsonb OR EXISTS (SELECT 1 FROM "Photo" ph WHERE ph."entityId"=r.id AND ph."entityType"::text='PREPARATION'))) THEN
      UPDATE "FleetPreparation" SET "currentRevision"="currentRevision"+1 WHERE id=prep_id;
      INSERT INTO "FleetPreparationRevision" (id,"clientId","preparationId",revision) SELECT gen_random_uuid()::text,"clientId",id,"currentRevision" FROM "FleetPreparation" WHERE id=prep_id;
    END IF;
    INSERT INTO "FleetPreparationEvent" (id,"clientId","preparationId",action,data,"createdAt") SELECT gen_random_uuid()::text,"clientId",id,'INSTALLATION_INVALIDATED',jsonb_build_object('component',component_kind),CURRENT_TIMESTAMP FROM "FleetPreparation" WHERE id=prep_id;
  END LOOP;
END $$;

CREATE FUNCTION public.kyc_guard_used_definition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE definition_id TEXT;
BEGIN
    IF TG_TABLE_NAME = 'KycWorkflowDefinition' THEN
        definition_id := OLD."id";
    ELSIF TG_OP = 'INSERT' THEN
        definition_id := NEW."workflowDefinitionId";
    ELSE
        definition_id := OLD."workflowDefinitionId";
    END IF;
    IF definition_id IS NOT NULL AND EXISTS (SELECT 1 FROM "KycWorkflowExecution" WHERE "workflowDefinitionId" = definition_id) THEN
        RAISE EXCEPTION 'KYC_WORKFLOW_DEFINITION_VERSION_IN_USE' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME <> 'KycWorkflowDefinition' THEN
        IF NEW."workflowDefinitionId" IS DISTINCT FROM OLD."workflowDefinitionId"
           AND EXISTS (SELECT 1 FROM "KycWorkflowExecution" WHERE "workflowDefinitionId" = NEW."workflowDefinitionId") THEN
            RAISE EXCEPTION 'KYC_WORKFLOW_DEFINITION_VERSION_IN_USE' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.kyc_guard_used_routing_policy() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE policy_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'KycRoutingPolicy' THEN
    policy_id := OLD."id";
  ELSIF TG_OP = 'INSERT' THEN
    policy_id := NEW."routingPolicyId";
  ELSE
    policy_id := OLD."routingPolicyId";
  END IF;
  IF EXISTS (SELECT 1 FROM "KycRoutingDecision" WHERE "routingPolicyId" = policy_id) THEN
    RAISE EXCEPTION 'KYC_ROUTING_POLICY_VERSION_IN_USE' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'KycRoutingProvider' THEN
    IF NEW."routingPolicyId" IS DISTINCT FROM OLD."routingPolicyId" AND
       EXISTS (SELECT 1 FROM "KycRoutingDecision" WHERE "routingPolicyId" = NEW."routingPolicyId") THEN
      RAISE EXCEPTION 'KYC_ROUTING_POLICY_VERSION_IN_USE' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.prevent_vehicle_catalog_code_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW."code" IS DISTINCT FROM OLD."code" THEN
    RAISE EXCEPTION 'Catalog code cannot be changed after creation.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.protect_rider_agreement_terms() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW."pricingSnapshot" IS DISTINCT FROM OLD."pricingSnapshot" OR
     NEW."clientId" IS DISTINCT FROM OLD."clientId" OR
     NEW."commercialOfferId" IS DISTINCT FROM OLD."commercialOfferId" OR
     NEW."riderId" IS DISTINCT FROM OLD."riderId" OR
     NEW."vehicleId" IS DISTINCT FROM OLD."vehicleId" OR
     NEW."hubId" IS DISTINCT FROM OLD."hubId" OR
     NEW."rateCardId" IS DISTINCT FROM OLD."rateCardId" OR
     NEW."rentalPeriodType" IS DISTINCT FROM OLD."rentalPeriodType" OR
     NEW."durationValue" IS DISTINCT FROM OLD."durationValue" OR
     NEW."durationUnit" IS DISTINCT FROM OLD."durationUnit" OR
     NEW."batteryPlanId" IS DISTINCT FROM OLD."batteryPlanId" OR
     NEW."currency" IS DISTINCT FROM OLD."currency" OR
     NEW."pricingSnapshotSchemaVersion" IS DISTINCT FROM OLD."pricingSnapshotSchemaVersion" OR
     NEW."pricingHash" IS DISTINCT FROM OLD."pricingHash" OR
     NEW."termsTitle" IS DISTINCT FROM OLD."termsTitle" OR
    NEW."termsSnapshot" IS DISTINCT FROM OLD."termsSnapshot" OR
     NEW."termsHash" IS DISTINCT FROM OLD."termsHash" OR
     NEW."termsVersion" IS DISTINCT FROM OLD."termsVersion" OR
     NEW."finalRecurringAmount" IS DISTINCT FROM OLD."finalRecurringAmount" OR
     NEW."upfrontAmount" IS DISTINCT FROM OLD."upfrontAmount" OR
     NEW."refundableAmount" IS DISTINCT FROM OLD."refundableAmount" OR
     NEW."rateCardVersionId" IS DISTINCT FROM OLD."rateCardVersionId"
  THEN RAISE EXCEPTION 'Agreement commercial terms are immutable; create an amendment'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.protect_rider_offer_terms() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD."status" <> 'CALCULATED' AND (
    NEW."clientId" IS DISTINCT FROM OLD."clientId" OR
    NEW."riderId" IS DISTINCT FROM OLD."riderId" OR
    NEW."vehicleId" IS DISTINCT FROM OLD."vehicleId" OR
    NEW."hubId" IS DISTINCT FROM OLD."hubId" OR
    NEW."rateCardId" IS DISTINCT FROM OLD."rateCardId" OR
    NEW."rentalPeriodType" IS DISTINCT FROM OLD."rentalPeriodType" OR
    NEW."durationValue" IS DISTINCT FROM OLD."durationValue" OR
    NEW."durationUnit" IS DISTINCT FROM OLD."durationUnit" OR
    NEW."batteryPlanId" IS DISTINCT FROM OLD."batteryPlanId" OR
    NEW."effectiveDate" IS DISTINCT FROM OLD."effectiveDate" OR
    NEW."currency" IS DISTINCT FROM OLD."currency" OR
    NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" OR
    NEW."selectionHash" IS DISTINCT FROM OLD."selectionHash" OR
    NEW."pricingSnapshot" IS DISTINCT FROM OLD."pricingSnapshot" OR
    NEW."pricingSnapshotSchemaVersion" IS DISTINCT FROM OLD."pricingSnapshotSchemaVersion" OR
    NEW."calculationHash" IS DISTINCT FROM OLD."calculationHash" OR
    NEW."termsTitle" IS DISTINCT FROM OLD."termsTitle" OR
    NEW."termsSnapshot" IS DISTINCT FROM OLD."termsSnapshot" OR
    NEW."termsHash" IS DISTINCT FROM OLD."termsHash" OR
    NEW."termsVersion" IS DISTINCT FROM OLD."termsVersion" OR
    NEW."finalRecurringAmount" IS DISTINCT FROM OLD."finalRecurringAmount" OR
    NEW."upfrontAmount" IS DISTINCT FROM OLD."upfrontAmount" OR
    NEW."refundableAmount" IS DISTINCT FROM OLD."refundableAmount" OR
    NEW."rateCardVersionId" IS DISTINCT FROM OLD."rateCardVersionId"
  ) THEN RAISE EXCEPTION 'Presented offer commercial terms are immutable'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.readiness_component_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE kind TEXT;
BEGIN
  kind:=CASE WHEN TG_TABLE_NAME='FleetBatteryHistory' THEN 'BATTERY' ELSE 'CONTROLLER' END;
  IF TG_OP <> 'INSERT' THEN PERFORM invalidate_installation_component(OLD."fleetId",kind); PERFORM invalidate_fleet_readiness(OLD."fleetId",'Installed component changed.'); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM invalidate_installation_component(NEW."fleetId",kind); PERFORM invalidate_fleet_readiness(NEW."fleetId",'Installed component changed.'); END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION public.readiness_component_identity_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE f TEXT; kind TEXT;
BEGIN
  kind:=CASE WHEN TG_TABLE_NAME='Battery' THEN 'BATTERY' WHEN TG_TABLE_NAME='Controller' THEN 'CONTROLLER' ELSE 'IOT' END;
  IF kind='BATTERY' THEN
    FOR f IN SELECT "fleetId" FROM "FleetBatteryHistory" WHERE "batteryId"=NEW.id AND "removedAt" IS NULL LOOP PERFORM invalidate_installation_component(f,kind); PERFORM invalidate_fleet_readiness(f,'Battery identity changed.'); END LOOP;
  ELSIF kind='CONTROLLER' THEN
    FOR f IN SELECT "fleetId" FROM "FleetControllerHistory" WHERE "controllerId"=NEW.id AND "removedAt" IS NULL LOOP PERFORM invalidate_installation_component(f,kind); PERFORM invalidate_fleet_readiness(f,'Controller identity changed.'); END LOOP;
  ELSE
    FOR f IN SELECT id FROM "Fleet" WHERE "iotDeviceId"=NEW.id LOOP PERFORM invalidate_installation_component(f,kind); PERFORM invalidate_fleet_readiness(f,'IoT identity changed.'); END LOOP;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.readiness_submission_received() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM invalidate_fleet_readiness(NEW."fleetId",'Vehicle received for submission.');
  RETURN NEW;
END $$;

CREATE FUNCTION public.record_fleet_manager_home_history() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE row_data JSONB; previous_data JSONB; projected JSONB;
BEGIN
 IF TG_OP <> 'INSERT' THEN previous_data := to_jsonb(OLD); END IF;
 IF TG_OP = 'DELETE' THEN
   IF previous_data->>'clientId' IS NOT NULL THEN
     INSERT INTO "FleetManagerHomeHistory" ("clientId", "entityType", "entityId", "data")
     VALUES (previous_data->>'clientId', TG_TABLE_NAME, previous_data->>'id', NULL);
   END IF;
   RETURN OLD;
 END IF;
 row_data := to_jsonb(NEW);
 IF TG_OP = 'UPDATE' AND previous_data->>'clientId' IS DISTINCT FROM row_data->>'clientId' AND previous_data->>'clientId' IS NOT NULL THEN
   INSERT INTO "FleetManagerHomeHistory" ("clientId", "entityType", "entityId", "data")
   VALUES (previous_data->>'clientId', TG_TABLE_NAME, previous_data->>'id', NULL);
 END IF;
 IF row_data->>'clientId' IS NULL THEN RETURN NEW; END IF;
 SELECT jsonb_object_agg(key, value) INTO projected FROM jsonb_each(row_data) WHERE key = ANY(TG_ARGV);
 IF TG_OP = 'UPDATE' AND NOT EXISTS (
   SELECT 1 FROM jsonb_each(projected) WHERE value IS DISTINCT FROM previous_data->key
 ) THEN RETURN NEW; END IF;
 INSERT INTO "FleetManagerHomeHistory" ("clientId", "entityType", "entityId", "data")
 VALUES (row_data->>'clientId', TG_TABLE_NAME, row_data->>'id', projected);
 RETURN NEW;
END; $$;

CREATE FUNCTION public.reject_commercial_version_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW."pricingSnapshot" IS DISTINCT FROM OLD."pricingSnapshot" OR
     NEW."pricingHash" IS DISTINCT FROM OLD."pricingHash" OR
     NEW."termsVersion" IS DISTINCT FROM OLD."termsVersion" OR
     NEW."termsHash" IS DISTINCT FROM OLD."termsHash" OR
     NEW."termsSnapshot" IS DISTINCT FROM OLD."termsSnapshot" OR
     NEW."termsTitle" IS DISTINCT FROM OLD."termsTitle" OR
     NEW."vehicleId" IS DISTINCT FROM OLD."vehicleId" OR
     NEW."rateCardVersionId" IS DISTINCT FROM OLD."rateCardVersionId" OR
     NEW."recurringAmount" IS DISTINCT FROM OLD."recurringAmount" THEN
    RAISE EXCEPTION 'COMMERCIAL_VERSION_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.reject_exchange_amendment_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW."previousPricingHash" IS DISTINCT FROM OLD."previousPricingHash" OR
     NEW."proposedPricingHash" IS DISTINCT FROM OLD."proposedPricingHash" OR
     NEW."proposedPricingSnapshot" IS DISTINCT FROM OLD."proposedPricingSnapshot" OR
     NEW."commercialDifference" IS DISTINCT FROM OLD."commercialDifference" OR
     NEW."previousVehicleId" IS DISTINCT FROM OLD."previousVehicleId" OR
     NEW."replacementVehicleId" IS DISTINCT FROM OLD."replacementVehicleId" THEN
    RAISE EXCEPTION 'EXCHANGE_AMENDMENT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.reject_exchange_offer_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW."pricingSnapshot" IS DISTINCT FROM OLD."pricingSnapshot" OR
     NEW."pricingHash" IS DISTINCT FROM OLD."pricingHash" OR
     NEW."commercialDifference" IS DISTINCT FROM OLD."commercialDifference" OR
     NEW."offerHash" IS DISTINCT FROM OLD."offerHash" OR
     NEW."termsSnapshot" IS DISTINCT FROM OLD."termsSnapshot" OR
     NEW."termsTitle" IS DISTINCT FROM OLD."termsTitle" OR
     NEW."termsHash" IS DISTINCT FROM OLD."termsHash" OR
     NEW."termsVersion" IS DISTINCT FROM OLD."termsVersion" THEN
    RAISE EXCEPTION 'EXCHANGE_OFFER_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.rider_deposit_obligation_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  posted_balance DECIMAL(14,2);
  posted_funding DECIMAL(14,2);
BEGIN
  IF NEW."clientId" IS DISTINCT FROM OLD."clientId" OR
     NEW."riderId" IS DISTINCT FROM OLD."riderId" OR
     NEW."agreementId" IS DISTINCT FROM OLD."agreementId" OR
     NEW."vehicleId" IS DISTINCT FROM OLD."vehicleId" OR
     NEW."obligationKey" IS DISTINCT FROM OLD."obligationKey" OR
     NEW."depositType" IS DISTINCT FROM OLD."depositType" OR
     NEW."code" IS DISTINCT FROM OLD."code" OR
     NEW."currency" IS DISTINCT FROM OLD."currency" OR
     NEW."originalRequiredAmount" IS DISTINCT FROM OLD."originalRequiredAmount" OR
     NEW."waiverAmount" IS DISTINCT FROM OLD."waiverAmount" OR
     NEW."requiredAmount" IS DISTINCT FROM OLD."requiredAmount" OR
     NEW."snapshotLine" IS DISTINCT FROM OLD."snapshotLine" OR
     NEW."sourceType" IS DISTINCT FROM OLD."sourceType" OR
     NEW."sourceId" IS DISTINCT FROM OLD."sourceId"
  THEN RAISE EXCEPTION 'Accepted deposit obligation is immutable'; END IF;
  SELECT COALESCE(SUM("balanceDelta"), 0), COALESCE(SUM("fundingDelta"), 0)
    INTO posted_balance, posted_funding
    FROM "RiderDepositTransaction" WHERE "depositId" = NEW."id";
  IF NEW."availableAmount" IS DISTINCT FROM posted_balance OR
     NEW."fundedAmount" IS DISTINCT FROM posted_funding
  THEN RAISE EXCEPTION 'Deposit materialized balances must reconcile to transactions'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.rider_deposit_transaction_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'Deposit transactions are immutable; post a reversal';
END $$;

CREATE FUNCTION public.rider_invoice_line_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE prior_status "RiderInvoiceStatus";
DECLARE target_status "RiderInvoiceStatus";
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "status" INTO prior_status FROM "RiderInvoice" WHERE "id" = OLD."invoiceId";
    IF prior_status <> 'DRAFT' THEN RAISE EXCEPTION 'Finalized invoice lines are immutable'; END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "status" INTO target_status FROM "RiderInvoice" WHERE "id" = NEW."invoiceId";
    IF target_status <> 'DRAFT' THEN RAISE EXCEPTION 'Finalized invoice lines are immutable'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.rider_invoice_no_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' THEN RAISE EXCEPTION 'Finalized invoices cannot be deleted'; END IF;
  RETURN OLD;
END;
$$;

CREATE FUNCTION public.rider_invoice_snapshot_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' AND (
    NEW."clientId", NEW."riderId", NEW."invoiceNumber", NEW."billingPeriodStart",
    NEW."billingPeriodEnd", NEW."subtotal", NEW."creditAmount", NEW."adjustmentAmount",
    NEW."taxAmount", NEW."totalAmount", NEW."currency", NEW."agreementId",
    NEW."billingPeriodId", NEW."taxSnapshot", NEW."dueDate", NEW."issuedAt"
  ) IS DISTINCT FROM (
    OLD."clientId", OLD."riderId", OLD."invoiceNumber", OLD."billingPeriodStart",
    OLD."billingPeriodEnd", OLD."subtotal", OLD."creditAmount", OLD."adjustmentAmount",
    OLD."taxAmount", OLD."totalAmount", OLD."currency", OLD."agreementId",
    OLD."billingPeriodId", OLD."taxSnapshot", OLD."dueDate", OLD."issuedAt"
  ) THEN
    RAISE EXCEPTION 'Issued invoice financial snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.rider_ledger_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'Rider ledger entries are immutable; post a compensating entry';
END;
$$;

CREATE FUNCTION public.rider_payment_allocation_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payment allocations are append-only';
  END IF;
  IF (NEW."clientId", NEW."riderId", NEW."paymentId", NEW."invoiceId", NEW."amount", NEW."createdAt", NEW."createdById") IS DISTINCT FROM
     (OLD."clientId", OLD."riderId", OLD."paymentId", OLD."invoiceId", OLD."amount", OLD."createdAt", OLD."createdById")
     OR OLD."reversedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Payment allocations may only be reversed once';
  END IF;
  IF NEW."reversedAt" IS NULL OR NEW."reversalReason" IS NULL OR btrim(NEW."reversalReason") = '' THEN
    RAISE EXCEPTION 'Allocation reversal needs timestamp and reason';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.rider_payment_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Recorded payments are immutable'; END IF;
  IF (NEW."clientId", NEW."riderId", NEW."amount", NEW."currency", NEW."method", NEW."externalReference", NEW."idempotencyKey", NEW."receivedAt", NEW."createdById", NEW."createdAt") IS DISTINCT FROM
     (OLD."clientId", OLD."riderId", OLD."amount", OLD."currency", OLD."method", OLD."externalReference", OLD."idempotencyKey", OLD."receivedAt", OLD."createdById", OLD."createdAt") THEN
    RAISE EXCEPTION 'Recorded payment financial details are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.spare_origin_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
  IF OLD."clientId" IS DISTINCT FROM NEW."clientId" OR OLD."masterSpareId" IS DISTINCT FROM NEW."masterSpareId" OR OLD."isSpare" IS DISTINCT FROM NEW."isSpare" OR OLD.code IS DISTINCT FROM NEW.code THEN RAISE EXCEPTION 'Spare ownership, origin and part code are immutable.'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.sync_hub_location() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW."latitude" BETWEEN -90 AND 90 AND NEW."longitude" BETWEEN -180 AND 180 THEN
    NEW."location" := ST_SetSRID(ST_MakePoint(NEW."longitude"::double precision, NEW."latitude"::double precision),4326)::geography;
  ELSE
    NEW."location" := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.wallet_invoice_line_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "RiderInvoice" WHERE "id" = OLD."invoiceId" AND "status" <> 'DRAFT') THEN
    RAISE EXCEPTION 'Issued invoice lines are immutable';
  END IF;
  RETURN OLD;
END;
$$;

CREATE FUNCTION public.wallet_invoice_terms_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' AND (
    NEW."invoiceType" IS DISTINCT FROM OLD."invoiceType" OR
    NEW."sourceKey" IS DISTINCT FROM OLD."sourceKey" OR
    NEW."pricingSnapshot" IS DISTINCT FROM OLD."pricingSnapshot" OR
    NEW."subtotal" IS DISTINCT FROM OLD."subtotal" OR
    NEW."creditAmount" IS DISTINCT FROM OLD."creditAmount" OR
    NEW."taxAmount" IS DISTINCT FROM OLD."taxAmount" OR
    NEW."totalAmount" IS DISTINCT FROM OLD."totalAmount" OR
    NEW."billingPeriodStart" IS DISTINCT FROM OLD."billingPeriodStart" OR
    NEW."billingPeriodEnd" IS DISTINCT FROM OLD."billingPeriodEnd"
  ) THEN RAISE EXCEPTION 'Issued invoice pricing is immutable'; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.wallet_ledger_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'Wallet ledger entries are immutable';
END;
$$;

ALTER TABLE ONLY public."RiderBillingPeriod"
    ADD CONSTRAINT "RiderBillingPeriod_no_overlap" EXCLUDE USING gist ("agreementId" WITH =, tsrange("periodStart", "periodEnd", '[)'::text) WITH &&);

ALTER TABLE ONLY public."RiderTaxRule"
    ADD CONSTRAINT "RiderTaxRule_no_overlap" EXCLUDE USING gist ("clientId" WITH =, "chargeType" WITH =, tsrange("effectiveFrom", "effectiveTo", '[)'::text) WITH &&);

ALTER TABLE ONLY public."RiderRateCardVersion"
    ADD CONSTRAINT no_overlapping_active_rate_card_versions EXCLUDE USING gist ("clientId" WITH =, "rateCardId" WITH =, daterange("effectiveFrom", "effectiveTo", '[)'::text) WITH &&) WHERE ((status = 'ACTIVE'::public."RiderRateCardStatus"));

ALTER TABLE ONLY public."VehicleCommercialGradeAssignment"
    ADD CONSTRAINT no_overlapping_vehicle_grade_periods EXCLUDE USING gist ("clientId" WITH =, "fleetId" WITH =, daterange("effectiveFrom", "effectiveTo", '[)'::text) WITH &&);

CREATE UNIQUE INDEX "AppLegalDocument_global_version_key" ON public."AppLegalDocument" USING btree ("appCode", role, kind, locale, version) WHERE ("clientId" IS NULL);

CREATE UNIQUE INDEX "AttendancePeriod_userId_open_key" ON public."AttendancePeriod" USING btree ("userId") WHERE ("checkOutAt" IS NULL);

CREATE INDEX "ClientSubscription_packageRevisionId_idx" ON public."ClientSubscription" USING btree ("packageRevisionId");

CREATE UNIQUE INDEX "CollectionPolicy_one_active_per_client" ON public."CollectionPolicy" USING btree ("clientId") WHERE (status = 'ACTIVE'::text);

CREATE UNIQUE INDEX "FleetTransfer_one_open_per_fleet" ON public."FleetTransfer" USING btree ("fleetId") WHERE (status = ANY (ARRAY['INITIATED'::public."FleetTransferStatus", 'IN_TRANSIT'::public."FleetTransferStatus"]));

CREATE UNIQUE INDEX "KycClientPolicy_one_active_per_type" ON public."KycClientPolicy" USING btree ("clientId", "verificationType") WHERE (status = 'ACTIVE'::text);

CREATE UNIQUE INDEX "KycIntelligentRoutingPolicy_global_code_version_key" ON public."KycIntelligentRoutingPolicy" USING btree (code, version) WHERE ("clientId" IS NULL);

CREATE UNIQUE INDEX "KycRoutingPolicy_global_version" ON public."KycRoutingPolicy" USING btree (code, version) WHERE ("clientId" IS NULL);

CREATE UNIQUE INDEX "KycWorkflowDefinition_global_version" ON public."KycWorkflowDefinition" USING btree (code, version) WHERE ("clientId" IS NULL);

CREATE UNIQUE INDEX "KycWorkflowExecution_one_active_rider" ON public."KycWorkflowExecution" USING btree ("clientId", "riderId") WHERE (status = ANY (ARRAY['CREATED'::public."KycWorkflowStatus", 'IN_PROGRESS'::public."KycWorkflowStatus", 'ACTION_REQUIRED'::public."KycWorkflowStatus", 'WAITING'::public."KycWorkflowStatus", 'RECONCILING'::public."KycWorkflowStatus", 'DECISION_PENDING'::public."KycWorkflowStatus"]));

CREATE UNIQUE INDEX "PaymentCollectionRequest_active_deposit_key" ON public."PaymentCollectionRequest" USING btree ("clientId", "depositId") WHERE (("depositId" IS NOT NULL) AND ((status)::text = ANY (ARRAY[('CREATING'::character varying)::text, ('PENDING'::character varying)::text, ('UNKNOWN'::character varying)::text])));

CREATE UNIQUE INDEX "PaymentCollectionRequest_active_invoice_key" ON public."PaymentCollectionRequest" USING btree ("clientId", "invoiceId") WHERE (("invoiceId" IS NOT NULL) AND ((status)::text = ANY (ARRAY[('CREATING'::character varying)::text, ('PENDING'::character varying)::text, ('UNKNOWN'::character varying)::text])));

CREATE UNIQUE INDEX "PaymentCollectionRequest_active_outstanding_key" ON public."PaymentCollectionRequest" USING btree ("clientId", "riderId") WHERE ((("collectionType")::text = 'OUTSTANDING_PAYMENT'::text) AND ((status)::text = ANY (ARRAY[('CREATING'::character varying)::text, ('PENDING'::character varying)::text, ('UNKNOWN'::character varying)::text])));

CREATE UNIQUE INDEX "PaymentMandate_one_open_per_rider" ON public."PaymentMandate" USING btree ("clientId", "riderId") WHERE (status = ANY (ARRAY['CREATING'::public."PaymentMandateStatus", 'CREATED'::public."PaymentMandateStatus", 'AUTHORIZATION_PENDING'::public."PaymentMandateStatus", 'ACTIVE'::public."PaymentMandateStatus", 'PAUSED'::public."PaymentMandateStatus", 'UNKNOWN'::public."PaymentMandateStatus"]));

CREATE UNIQUE INDEX "PaymentTransaction_active_invoice_key" ON public."PaymentTransaction" USING btree ("clientId", "invoiceId") WHERE (status = ANY (ARRAY['CREATING'::public."PaymentTransactionStatus", 'PENDING'::public."PaymentTransactionStatus", 'UNKNOWN'::public."PaymentTransactionStatus", 'SUCCESS'::public."PaymentTransactionStatus"]));

CREATE UNIQUE INDEX "PhotoRequirement_clientId_workFlowType_subjectType_photoType_ke" ON public."PhotoRequirement" USING btree ("clientId", "workFlowType", "subjectType", "photoType");

CREATE INDEX "PhotoRequirement_clientId_workFlowType_subjectType_sortOrder_id" ON public."PhotoRequirement" USING btree ("clientId", "workFlowType", "subjectType", "sortOrder");

CREATE UNIQUE INDEX "User_client_normalized_mobile_key" ON public."User" USING btree ("clientId", "right"(regexp_replace(mobile, '[^0-9]'::text, ''::text, 'g'::text), 10)) WHERE (("deletedAt" IS NULL) AND ("clientId" IS NOT NULL));

CREATE UNIQUE INDEX battery_one_active_installation ON public."FleetBatteryHistory" USING btree ("batteryId") WHERE ("removedAt" IS NULL);

CREATE UNIQUE INDEX controller_one_active_installation ON public."FleetControllerHistory" USING btree ("controllerId") WHERE ("removedAt" IS NULL);

CREATE INDEX idx_hub_location ON public."Hub" USING gist (location);

CREATE UNIQUE INDEX one_active_exchange_per_agreement ON public."VehicleExchangeRequest" USING btree ("clientId", "agreementId") WHERE (status = ANY (ARRAY['REQUESTED'::public."VehicleExchangeStatus", 'APPROVED'::public."VehicleExchangeStatus", 'REPLACEMENT_SELECTED'::public."VehicleExchangeStatus", 'OFFER_PRESENTED'::public."VehicleExchangeStatus", 'ACCEPTED'::public."VehicleExchangeStatus", 'RETURN_PENDING'::public."VehicleExchangeStatus", 'DEPOSIT_PENDING'::public."VehicleExchangeStatus", 'HANDOVER_PENDING'::public."VehicleExchangeStatus"]));

CREATE UNIQUE INDEX one_active_push_token ON public."PushDevice" USING btree ("tokenHash") WHERE "isActive";

CREATE UNIQUE INDEX one_active_rider_terms_per_client ON public."RiderCommercialTerms" USING btree ("clientId") WHERE (status = 'ACTIVE'::public."RiderCommercialTermsStatus");

CREATE UNIQUE INDEX one_default_rider_rate_card_per_client ON public."RiderRateCard" USING btree ("clientId") WHERE (("isDefault" = true) AND (status <> 'INACTIVE'::public."RiderRateCardStatus"));

CREATE UNIQUE INDEX one_live_agreement_per_rider ON public."RiderRentalAgreement" USING btree ("clientId", "riderId") WHERE (status = ANY (ARRAY['PENDING_ACTIVATION'::public."RiderRentalAgreementStatus", 'ACTIVE'::public."RiderRentalAgreementStatus", 'SUSPENDED'::public."RiderRentalAgreementStatus", 'TERMINATION_PENDING'::public."RiderRentalAgreementStatus"]));

CREATE UNIQUE INDEX one_live_agreement_per_vehicle ON public."RiderRentalAgreement" USING btree ("clientId", "currentVehicleId") WHERE (status = ANY (ARRAY['PENDING_ACTIVATION'::public."RiderRentalAgreementStatus", 'ACTIVE'::public."RiderRentalAgreementStatus", 'SUSPENDED'::public."RiderRentalAgreementStatus", 'TERMINATION_PENDING'::public."RiderRentalAgreementStatus"]));

CREATE UNIQUE INDEX one_pending_vehicle_submission_report ON public."VehicleSubmissionReport" USING btree ("submissionId") WHERE ((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'SUBMITTED'::character varying])::text[]));

CREATE UNIQUE INDEX one_posted_basic_vehicle_report ON public."VehicleSubmissionReport" USING btree ("submissionId") WHERE (((stage)::text = 'BASIC'::text) AND ((status)::text = 'POSTED'::text));

CREATE UNIQUE INDEX one_replacement_hold_per_vehicle ON public."VehicleExchangeRequest" USING btree ("clientId", "replacementVehicleId") WHERE (("replacementVehicleId" IS NOT NULL) AND (status = ANY (ARRAY['REPLACEMENT_SELECTED'::public."VehicleExchangeStatus", 'OFFER_PRESENTED'::public."VehicleExchangeStatus", 'ACCEPTED'::public."VehicleExchangeStatus", 'RETURN_PENDING'::public."VehicleExchangeStatus", 'DEPOSIT_PENDING'::public."VehicleExchangeStatus", 'HANDOVER_PENDING'::public."VehicleExchangeStatus"])));

CREATE UNIQUE INDEX preparation_one_open_cycle ON public."FleetPreparation" USING btree ("fleetId") WHERE ((status)::text = ANY ((ARRAY['PENDING'::character varying, 'IN_PROGRESS'::character varying, 'AWAITING_QC'::character varying, 'REWORK_REQUIRED'::character varying])::text[]));

CREATE UNIQUE INDEX rider_invoice_rental_period_unique ON public."RiderInvoice" USING btree ("clientId", "riderId", "billingPeriodStart", "billingPeriodEnd") WHERE (("invoiceType")::text = 'RENTAL'::text);

CREATE UNIQUE INDEX wallet_one_current_policy_per_client ON public."WalletPolicy" USING btree ("clientId") WHERE ("effectiveUntil" IS NULL);

CREATE UNIQUE INDEX wallet_single_full_reversal ON public."WalletTransaction" USING btree ("parentTransactionId") WHERE ("transactionType" = 'REVERSAL'::public."WalletTransactionType");

CREATE TRIGGER "Oem_code_immutable" BEFORE UPDATE OF code ON public."Oem" FOR EACH ROW EXECUTE FUNCTION public.prevent_vehicle_catalog_code_change();

CREATE TRIGGER "VehicleCategory_code_immutable" BEFORE UPDATE OF code ON public."VehicleCategory" FOR EACH ROW EXECUTE FUNCTION public.prevent_vehicle_catalog_code_change();

CREATE TRIGGER "VehicleType_code_immutable" BEFORE UPDATE OF code ON public."VehicleType" FOR EACH ROW EXECUTE FUNCTION public.prevent_vehicle_catalog_code_change();

CREATE TRIGGER collection_event_audit AFTER INSERT ON public."CollectionEvent" FOR EACH ROW EXECUTE FUNCTION public.collection_audit_event();

CREATE TRIGGER collection_invoice_changed AFTER INSERT OR UPDATE OF "outstandingAmount", status, "dueDate" ON public."RiderInvoice" FOR EACH ROW EXECUTE FUNCTION public.collection_enqueue_invoice_change();

CREATE TRIGGER commercial_version_immutable BEFORE UPDATE ON public."RiderAgreementCommercialVersion" FOR EACH ROW EXECUTE FUNCTION public.reject_commercial_version_mutation();

CREATE TRIGGER enforce_allocation_readiness BEFORE INSERT OR UPDATE OF status ON public."Allocation" FOR EACH ROW EXECUTE FUNCTION public.enforce_allocation_readiness();

CREATE TRIGGER enforce_fleet_readiness BEFORE INSERT OR UPDATE ON public."Fleet" FOR EACH ROW EXECUTE FUNCTION public.enforce_fleet_readiness();

CREATE TRIGGER exchange_amendment_immutable BEFORE UPDATE ON public."RiderRentalAgreementAmendment" FOR EACH ROW WHEN ((old."exchangeRequestId" IS NOT NULL)) EXECUTE FUNCTION public.reject_exchange_amendment_mutation();

CREATE TRIGGER exchange_offer_immutable BEFORE UPDATE ON public."VehicleExchangeOffer" FOR EACH ROW EXECUTE FUNCTION public.reject_exchange_offer_mutation();

CREATE TRIGGER fleet_manager_home_history AFTER INSERT OR DELETE OR UPDATE ON public."Allocation" FOR EACH ROW EXECUTE FUNCTION public.record_fleet_manager_home_history('id', 'clientId', 'fleetId', 'riderId', 'status', 'createdAt');

CREATE TRIGGER fleet_manager_home_history AFTER INSERT OR DELETE OR UPDATE ON public."Fleet" FOR EACH ROW EXECUTE FUNCTION public.record_fleet_manager_home_history('id', 'clientId', 'homeHubId', 'currentHubId', 'status', 'onboardingStatus', 'allocationEnabled', 'deletedAt');

CREATE TRIGGER fleet_manager_home_history AFTER INSERT OR DELETE OR UPDATE ON public."RentalTerminationRequest" FOR EACH ROW EXECUTE FUNCTION public.record_fleet_manager_home_history('id', 'clientId', 'allocationId', 'plannedHubId', 'status', 'submissionRequired', 'requestedTerminationDate');

CREATE TRIGGER fleet_manager_home_history AFTER INSERT OR DELETE OR UPDATE ON public."Rider" FOR EACH ROW EXECUTE FUNCTION public.record_fleet_manager_home_history('id', 'clientId', 'userId', 'status', 'deletedAt');

CREATE TRIGGER fleet_manager_home_history AFTER INSERT OR DELETE OR UPDATE ON public."User" FOR EACH ROW EXECUTE FUNCTION public.record_fleet_manager_home_history('id', 'clientId', 'role', 'isActive', 'deletedAt');

CREATE TRIGGER fleet_manager_home_history AFTER INSERT OR DELETE OR UPDATE ON public."UserHub" FOR EACH ROW EXECUTE FUNCTION public.record_fleet_manager_home_history('id', 'clientId', 'userId', 'hubId', 'isPrimary');

CREATE TRIGGER fleet_manager_home_history AFTER INSERT OR DELETE OR UPDATE ON public."VehicleExchangeRequest" FOR EACH ROW EXECUTE FUNCTION public.record_fleet_manager_home_history('id', 'clientId', 'oldAllocationId', 'plannedHubId', 'status', 'submissionRequired', 'plannedReturnDate');

CREATE TRIGGER fleet_manager_home_history AFTER INSERT OR DELETE OR UPDATE ON public."VehicleSubmission" FOR EACH ROW EXECUTE FUNCTION public.record_fleet_manager_home_history('id', 'clientId', 'allocationId', 'returnRequestId', 'exchangeRequestId', 'hubId', 'status', 'mechanicChecksComplete');

CREATE TRIGGER freeze_installation_evidence BEFORE UPDATE ON public."FleetInstallationStage" FOR EACH ROW EXECUTE FUNCTION public.freeze_installation_evidence();

CREATE TRIGGER freeze_preparation_photo BEFORE DELETE OR UPDATE ON public."Photo" FOR EACH ROW EXECUTE FUNCTION public.freeze_preparation_photo();

CREATE TRIGGER freeze_preparation_revision BEFORE UPDATE ON public."FleetPreparationRevision" FOR EACH ROW EXECUTE FUNCTION public.freeze_preparation_revision();

CREATE TRIGGER freeze_spare_revision BEFORE DELETE OR UPDATE ON public."SpareCatalogueRevision" FOR EACH ROW EXECUTE FUNCTION public.freeze_spare_revision();

CREATE TRIGGER hub_location_sync BEFORE INSERT OR UPDATE OF latitude, longitude ON public."Hub" FOR EACH ROW EXECUTE FUNCTION public.sync_hub_location();

CREATE TRIGGER installation_final_gate BEFORE UPDATE OF status ON public."FleetPreparation" FOR EACH ROW EXECUTE FUNCTION public.installation_final_gate();

CREATE TRIGGER installation_iot_changed AFTER UPDATE OF "iotDeviceId" ON public."Fleet" FOR EACH ROW WHEN ((old."iotDeviceId" IS DISTINCT FROM new."iotDeviceId")) EXECUTE FUNCTION public.installation_iot_changed();

CREATE TRIGGER kyc_definition_immutable BEFORE DELETE OR UPDATE ON public."KycWorkflowDefinition" FOR EACH ROW EXECUTE FUNCTION public.kyc_guard_used_definition();

CREATE TRIGGER kyc_routing_policy_immutable BEFORE DELETE OR UPDATE ON public."KycRoutingPolicy" FOR EACH ROW EXECUTE FUNCTION public.kyc_guard_used_routing_policy();

CREATE TRIGGER kyc_routing_provider_immutable BEFORE INSERT OR DELETE OR UPDATE ON public."KycRoutingProvider" FOR EACH ROW EXECUTE FUNCTION public.kyc_guard_used_routing_policy();

CREATE TRIGGER kyc_rule_immutable BEFORE INSERT OR DELETE OR UPDATE ON public."KycDecisionRule" FOR EACH ROW EXECUTE FUNCTION public.kyc_guard_used_definition();

CREATE TRIGGER kyc_step_immutable BEFORE INSERT OR DELETE OR UPDATE ON public."KycWorkflowStep" FOR EACH ROW EXECUTE FUNCTION public.kyc_guard_used_definition();

CREATE TRIGGER notification_message_content_guard BEFORE UPDATE ON public."NotificationMessage" FOR EACH ROW EXECUTE FUNCTION public.guard_notification_message_content();

CREATE TRIGGER protect_rider_agreement_terms_trigger BEFORE UPDATE ON public."RiderRentalAgreement" FOR EACH ROW EXECUTE FUNCTION public.protect_rider_agreement_terms();

CREATE TRIGGER protect_rider_offer_terms_trigger BEFORE UPDATE ON public."RiderCommercialOffer" FOR EACH ROW EXECUTE FUNCTION public.protect_rider_offer_terms();

CREATE TRIGGER readiness_battery_change AFTER INSERT OR DELETE OR UPDATE ON public."FleetBatteryHistory" FOR EACH ROW EXECUTE FUNCTION public.readiness_component_changed();

CREATE TRIGGER readiness_battery_identity AFTER UPDATE OF "serialNumber" ON public."Battery" FOR EACH ROW WHEN (((old."serialNumber")::text IS DISTINCT FROM (new."serialNumber")::text)) EXECUTE FUNCTION public.readiness_component_identity_changed();

CREATE TRIGGER readiness_controller_change AFTER INSERT OR DELETE OR UPDATE ON public."FleetControllerHistory" FOR EACH ROW EXECUTE FUNCTION public.readiness_component_changed();

CREATE TRIGGER readiness_controller_identity AFTER UPDATE OF "controllerNumber" ON public."Controller" FOR EACH ROW WHEN (((old."controllerNumber")::text IS DISTINCT FROM (new."controllerNumber")::text)) EXECUTE FUNCTION public.readiness_component_identity_changed();

CREATE TRIGGER readiness_iot_identity AFTER UPDATE OF "deviceNumber" ON public."IoTDevice" FOR EACH ROW WHEN (((old."deviceNumber")::text IS DISTINCT FROM (new."deviceNumber")::text)) EXECUTE FUNCTION public.readiness_component_identity_changed();

CREATE TRIGGER readiness_submission_received AFTER INSERT ON public."VehicleSubmission" FOR EACH ROW EXECUTE FUNCTION public.readiness_submission_received();

CREATE TRIGGER rider_deposit_obligation_immutable_trigger BEFORE UPDATE ON public."RiderDeposit" FOR EACH ROW EXECUTE FUNCTION public.rider_deposit_obligation_immutable();

CREATE TRIGGER rider_deposit_transaction_immutable_trigger BEFORE DELETE OR UPDATE ON public."RiderDepositTransaction" FOR EACH ROW EXECUTE FUNCTION public.rider_deposit_transaction_immutable();

CREATE TRIGGER rider_invoice_line_immutable BEFORE INSERT OR DELETE OR UPDATE ON public."RiderInvoiceLine" FOR EACH ROW EXECUTE FUNCTION public.rider_invoice_line_guard();

CREATE TRIGGER rider_invoice_preserve_history BEFORE DELETE ON public."RiderInvoice" FOR EACH ROW EXECUTE FUNCTION public.rider_invoice_no_delete();

CREATE TRIGGER rider_invoice_snapshot_immutable BEFORE UPDATE ON public."RiderInvoice" FOR EACH ROW EXECUTE FUNCTION public.rider_invoice_snapshot_guard();

CREATE TRIGGER rider_ledger_no_update BEFORE DELETE OR UPDATE ON public."RiderLedgerEntry" FOR EACH ROW EXECUTE FUNCTION public.rider_ledger_immutable();

CREATE TRIGGER rider_payment_allocation_immutable BEFORE DELETE OR UPDATE ON public."RiderPaymentAllocation" FOR EACH ROW EXECUTE FUNCTION public.rider_payment_allocation_guard();

CREATE TRIGGER rider_payment_immutable BEFORE DELETE OR UPDATE ON public."RiderPayment" FOR EACH ROW EXECUTE FUNCTION public.rider_payment_guard();

CREATE TRIGGER spare_origin_immutable BEFORE UPDATE ON public."ReturnPenaltyPrice" FOR EACH ROW EXECUTE FUNCTION public.spare_origin_immutable();

CREATE TRIGGER vehicle_mechanic_reuse_guard BEFORE UPDATE OF status, "allocationEnabled" ON public."Fleet" FOR EACH ROW EXECUTE FUNCTION public.guard_vehicle_mechanic_reuse();

CREATE TRIGGER vehicle_submission_allocation_guard BEFORE INSERT OR UPDATE OF status ON public."Allocation" FOR EACH ROW EXECUTE FUNCTION public.guard_vehicle_submission_allocation();

CREATE TRIGGER vehicle_submission_report_guard BEFORE UPDATE ON public."VehicleSubmissionReport" FOR EACH ROW EXECUTE FUNCTION public.guard_vehicle_submission_report();

CREATE TRIGGER wallet_invoice_allocation_no_change BEFORE DELETE OR UPDATE ON public."WalletInvoiceAllocation" FOR EACH ROW EXECUTE FUNCTION public.wallet_ledger_immutable();

CREATE TRIGGER wallet_invoice_line_no_change BEFORE DELETE OR UPDATE ON public."RiderInvoiceLine" FOR EACH ROW EXECUTE FUNCTION public.wallet_invoice_line_immutable();

CREATE TRIGGER wallet_invoice_terms_no_update BEFORE UPDATE ON public."RiderInvoice" FOR EACH ROW EXECUTE FUNCTION public.wallet_invoice_terms_immutable();

CREATE TRIGGER wallet_ledger_no_update BEFORE DELETE OR UPDATE ON public."WalletLedgerEntry" FOR EACH ROW EXECUTE FUNCTION public.wallet_ledger_immutable();

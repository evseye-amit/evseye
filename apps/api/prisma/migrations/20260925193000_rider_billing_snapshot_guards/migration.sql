-- A line cannot be moved away from a finalized invoice, even to a draft.
CREATE OR REPLACE FUNCTION rider_invoice_line_guard() RETURNS trigger AS $$
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
$$ LANGUAGE plpgsql;

-- Even a fully credited, line-free finalized invoice remains historical data.
CREATE FUNCTION rider_invoice_no_delete() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' THEN RAISE EXCEPTION 'Finalized invoices cannot be deleted'; END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER rider_invoice_preserve_history BEFORE DELETE ON "RiderInvoice"
FOR EACH ROW EXECUTE FUNCTION rider_invoice_no_delete();

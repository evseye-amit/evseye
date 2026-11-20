-- Successful debits remain immutable history after a refund. Only unresolved
-- attempts reserve an invoice; collect() still rejects an unreversed success.
DROP INDEX "PaymentTransaction_active_invoice_key";
CREATE UNIQUE INDEX "PaymentTransaction_active_invoice_key"
ON "PaymentTransaction" ("clientId", "invoiceId")
WHERE status IN ('CREATING', 'PENDING', 'UNKNOWN');

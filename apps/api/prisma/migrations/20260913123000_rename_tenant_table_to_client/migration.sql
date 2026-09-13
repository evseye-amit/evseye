-- The workspace isolation root is a Client in EvsEye business terminology.
-- PostgreSQL keeps all existing foreign-key relationships when the table is renamed.
ALTER TABLE "Tenant" RENAME TO "Client";

ALTER INDEX "Tenant_pkey" RENAME TO "Client_pkey";
ALTER INDEX "Tenant_slug_key" RENAME TO "Client_slug_key";
ALTER INDEX "Tenant_companyCode_key" RENAME TO "Client_companyCode_key";

-- Align the database role name with the client-facing product terminology.
ALTER TYPE "UserRole" RENAME VALUE 'TENANT_ADMIN' TO 'CLIENT_ADMIN';

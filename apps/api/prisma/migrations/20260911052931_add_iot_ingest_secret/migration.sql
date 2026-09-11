/*
  Warnings:

  - Added the required column `ingestSecretHash` to the `IoTDevice` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "IoTDevice" ADD COLUMN     "ingestSecretHash" TEXT NOT NULL;

ALTER TABLE "MaterialImportBatch"
  ADD COLUMN "fingerprintVersion" TEXT NOT NULL DEFAULT 'FORMAL-XLS-V1',
  ADD COLUMN "sourceProductionNumber" TEXT,
  ADD COLUMN "valid" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cancelledBy" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelReason" TEXT;

UPDATE "MaterialImportBatch"
SET "valid" = true
WHERE "status" IN ('PUBLISHED', 'WAREHOUSE_RELEASED');

CREATE INDEX "MaterialImportBatch_orderId_status_templateType_idx"
ON "MaterialImportBatch"("orderId", "status", "templateType");

ALTER TABLE "MaterialImportBatch"
  ALTER COLUMN "fingerprintVersion" SET DEFAULT 'LEGACY-UNSPECIFIED';

UPDATE "MaterialImportBatch"
SET "fingerprintVersion" = 'LEGACY-V2'
WHERE "parserVersion" <> 'V3.0';

-- Submitted or published legacy batches already passed the former preview gate.
-- Preserve their reviewability without accepting unrelated free drafts.
UPDATE "MaterialImportBatch"
SET "valid" = TRUE
WHERE "technicalPackageId" IS NOT NULL
  AND "status" <> 'CANCELLED'
  AND jsonb_typeof("errors") = 'array'
  AND jsonb_array_length("errors") = 0;

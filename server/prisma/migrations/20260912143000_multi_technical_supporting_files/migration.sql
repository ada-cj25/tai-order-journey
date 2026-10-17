ALTER TABLE "TechnicalPackageVersion"
ADD COLUMN "haixunAttachmentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "decompositionAttachmentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "TechnicalPackageVersion"
SET
  "haixunAttachmentIds" = ARRAY["haixunAttachmentId"],
  "decompositionAttachmentIds" = ARRAY["decompositionAttachmentId"];

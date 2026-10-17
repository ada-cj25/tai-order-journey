-- Expand the order aggregate without renumbering any existing production facts.
ALTER TABLE "Order" ADD COLUMN "salesNumber" TEXT;
ALTER TABLE "Order" ADD COLUMN "technicalAreasLockedAt" TIMESTAMP(3);

CREATE TABLE "SalesNumberSequence" (
  "id" TEXT NOT NULL,
  "yearMonth" TEXT NOT NULL,
  "prefix" TEXT NOT NULL,
  "lastValue" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesNumberSequence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesNumberSequence_yearMonth_prefix_key" ON "SalesNumberSequence"("yearMonth", "prefix");

-- Test records stay outside formal pools. Formal legacy orders are deterministically
-- ordered by their first design submission, falling back to creation time.
WITH source AS (
  SELECT
    o."id",
    o."trackingSerial",
    o."createdAt",
    CASE
      WHEN o."businessType"::text LIKE 'NOERLI_%' THEN 'N'
      WHEN o."businessType"::text LIKE 'AIKEJU_%' THEN 'A'
      WHEN o."businessType"::text LIKE 'CHANNEL_%' THEN 'C'
      WHEN o."businessType"::text LIKE 'ENGINEERING_%' THEN 'E'
      ELSE 'W'
    END AS prefix,
    COALESCE((SELECT MIN(s."submittedAt") FROM "StageSubmission" s WHERE s."orderId" = o."id" AND s."command" = 'SUBMIT_DESIGN'), o."createdAt") AS numbered_at,
    CASE WHEN o."trackingSerial" LIKE 'TEST-%' OR COALESCE(o."productionNumber", '') LIKE 'TEST-%' THEN TRUE ELSE FALSE END AS is_test
  FROM "Order" o
), ranked AS (
  SELECT
    source.*,
    TO_CHAR(numbered_at, 'YYMM') AS month_key,
    ROW_NUMBER() OVER (PARTITION BY prefix, TO_CHAR(numbered_at, 'YYMM') ORDER BY numbered_at, "createdAt", "id") AS seq
  FROM source
  WHERE NOT is_test
)
UPDATE "Order" o
SET "salesNumber" = ranked.prefix || ranked.month_key || LPAD(ranked.seq::text, 4, '0')
FROM ranked
WHERE o."id" = ranked."id";

UPDATE "Order"
SET "salesNumber" = 'TEST-SALES-' || "trackingSerial"
WHERE "salesNumber" IS NULL;

INSERT INTO "SalesNumberSequence" ("id", "yearMonth", "prefix", "lastValue", "updatedAt")
SELECT
  MD5('sales-sequence:' || SUBSTRING("salesNumber", 2, 4) || ':' || LEFT("salesNumber", 1))::uuid::text,
  '20' || SUBSTRING("salesNumber", 2, 4),
  LEFT("salesNumber", 1),
  MAX(RIGHT("salesNumber", 4)::integer),
  NOW()
FROM "Order"
WHERE "salesNumber" ~ '^[NACEW][0-9]{8}$'
GROUP BY LEFT("salesNumber", 1), SUBSTRING("salesNumber", 2, 4);

CREATE UNIQUE INDEX "Order_salesNumber_key" ON "Order"("salesNumber");

CREATE TABLE "ProductionArea" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "productionNumber" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "lockedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  "productionCompletedAt" TIMESTAMP(3),
  "shippedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductionArea_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionArea_productionNumber_key" ON "ProductionArea"("productionNumber");
CREATE UNIQUE INDEX "ProductionArea_orderId_sequence_key" ON "ProductionArea"("orderId", "sequence");
CREATE INDEX "ProductionArea_orderId_status_sequence_idx" ON "ProductionArea"("orderId", "status", "sequence");

INSERT INTO "ProductionArea" (
  "id", "orderId", "name", "sequence", "productionNumber", "status", "lockedAt",
  "productionCompletedAt", "shippedAt", "createdBy", "createdAt", "updatedAt"
)
SELECT
  MD5('production-area:' || o."id")::uuid::text,
  o."id",
  '历史未分区区域',
  1,
  o."productionNumber",
  CASE WHEN o."productionReady" THEN 'PRODUCTION_COMPLETE' ELSE 'LOCKED' END,
  o."createdAt",
  CASE WHEN o."productionReady" THEN COALESCE((SELECT MAX(p."completedAt") FROM "ProductionProcess" p WHERE p."orderId" = o."id"), o."updatedAt") END,
  CASE WHEN o."stage" IN ('INSTALLATION', 'ACCEPTANCE', 'BUSINESS_COMPLETE') THEN o."updatedAt" END,
  o."salesId",
  o."createdAt",
  o."updatedAt"
FROM "Order" o
WHERE o."productionNumber" IS NOT NULL;

UPDATE "Order" o
SET "technicalAreasLockedAt" = a."lockedAt"
FROM "ProductionArea" a
WHERE a."orderId" = o."id";

ALTER TABLE "ProductionProcess" ADD COLUMN "productionAreaId" TEXT;
ALTER TABLE "ProductionReport" ADD COLUMN "productionAreaId" TEXT;
ALTER TABLE "TechnicalPackageVersion" ADD COLUMN "productionAreaId" TEXT;
ALTER TABLE "TechnicalPackageVersion" ADD COLUMN "submissionSetId" TEXT;
ALTER TABLE "TechnicalPackageVersion" ADD COLUMN "panelEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TechnicalPackageVersion" ADD COLUMN "woodPaintEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "MaterialImportBatch" ADD COLUMN "productionAreaId" TEXT;
ALTER TABLE "MaterialListVersion" ADD COLUMN "productionAreaId" TEXT;
ALTER TABLE "OrderMaterialCostVersion" ADD COLUMN "productionAreaId" TEXT;
ALTER TABLE "Attachment" ADD COLUMN "productionAreaId" TEXT;

UPDATE "ProductionProcess" x SET "productionAreaId" = a."id" FROM "ProductionArea" a WHERE a."orderId" = x."orderId";
UPDATE "ProductionReport" x SET "productionAreaId" = a."id" FROM "ProductionArea" a WHERE a."orderId" = x."orderId";
UPDATE "TechnicalPackageVersion" x SET "productionAreaId" = a."id" FROM "ProductionArea" a WHERE a."orderId" = x."orderId";
UPDATE "MaterialImportBatch" x SET "productionAreaId" = a."id" FROM "ProductionArea" a WHERE a."orderId" = x."orderId";
UPDATE "MaterialListVersion" x SET "productionAreaId" = a."id" FROM "ProductionArea" a WHERE a."orderId" = x."orderId";
UPDATE "OrderMaterialCostVersion" x SET "productionAreaId" = a."id" FROM "ProductionArea" a WHERE a."orderId" = x."orderId";
UPDATE "Attachment" x
SET "productionAreaId" = a."id"
FROM "ProductionArea" a
WHERE a."orderId" = x."orderId"
  AND x."category" IN ('HAIXUN_EXPORT', 'DECOMPOSITION_SHEET', 'HARDWARE_MATERIALS', 'PAINT_WOOD', 'SOLID_WOOD_DOOR', 'VENEER_DOOR');

CREATE TABLE "TechnicalSubmissionSet" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
  "submittedBy" TEXT NOT NULL,
  "reviewedBy" TEXT,
  "reviewComment" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TechnicalSubmissionSet_pkey" PRIMARY KEY ("id")
);

INSERT INTO "TechnicalSubmissionSet" (
  "id", "orderId", "version", "status", "submittedBy", "reviewedBy", "reviewComment", "submittedAt", "reviewedAt", "createdAt", "updatedAt"
)
SELECT
  MD5('technical-submission-set:' || p."id")::uuid::text,
  p."orderId",
  p."version",
  p."status"::text,
  p."submittedBy",
  p."reviewedBy",
  p."reviewComment",
  p."submittedAt",
  p."reviewedAt",
  p."createdAt",
  p."updatedAt"
FROM "TechnicalPackageVersion" p;

UPDATE "TechnicalPackageVersion" p
SET "submissionSetId" = MD5('technical-submission-set:' || p."id")::uuid::text;

CREATE UNIQUE INDEX "TechnicalSubmissionSet_orderId_version_key" ON "TechnicalSubmissionSet"("orderId", "version");
CREATE INDEX "TechnicalSubmissionSet_orderId_status_submittedAt_idx" ON "TechnicalSubmissionSet"("orderId", "status", "submittedAt");

DROP INDEX IF EXISTS "ProductionProcess_orderId_workshop_processCode_key";
DROP INDEX IF EXISTS "TechnicalPackageVersion_orderId_version_key";
DROP INDEX IF EXISTS "MaterialListVersion_orderId_version_key";
DROP INDEX IF EXISTS "OrderMaterialCostVersion_orderId_version_key";

CREATE UNIQUE INDEX "ProductionProcess_productionAreaId_workshop_processCode_key" ON "ProductionProcess"("productionAreaId", "workshop", "processCode");
CREATE INDEX "ProductionProcess_productionAreaId_workshop_sequence_idx" ON "ProductionProcess"("productionAreaId", "workshop", "sequence");
CREATE UNIQUE INDEX "TechnicalPackageVersion_productionAreaId_version_key" ON "TechnicalPackageVersion"("productionAreaId", "version");
CREATE INDEX "TechnicalPackageVersion_orderId_version_idx" ON "TechnicalPackageVersion"("orderId", "version");
CREATE INDEX "MaterialImportBatch_productionAreaId_status_templateType_idx" ON "MaterialImportBatch"("productionAreaId", "status", "templateType");
CREATE UNIQUE INDEX "MaterialListVersion_productionAreaId_version_key" ON "MaterialListVersion"("productionAreaId", "version");
CREATE INDEX "MaterialListVersion_orderId_version_idx" ON "MaterialListVersion"("orderId", "version");
CREATE UNIQUE INDEX "OrderMaterialCostVersion_productionAreaId_version_key" ON "OrderMaterialCostVersion"("productionAreaId", "version");
CREATE INDEX "OrderMaterialCostVersion_orderId_version_idx" ON "OrderMaterialCostVersion"("orderId", "version");

ALTER TABLE "ProcurementCompletion" ALTER COLUMN "materialVersionId" DROP NOT NULL;

CREATE TABLE "ProcurementCompletionArea" (
  "id" TEXT NOT NULL,
  "procurementCompletionId" TEXT NOT NULL,
  "productionAreaId" TEXT NOT NULL,
  "materialVersionId" TEXT NOT NULL,
  CONSTRAINT "ProcurementCompletionArea_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ProcurementCompletionArea" ("id", "procurementCompletionId", "productionAreaId", "materialVersionId")
SELECT
  MD5('procurement-completion-area:' || c."id")::uuid::text,
  c."id",
  v."productionAreaId",
  c."materialVersionId"
FROM "ProcurementCompletion" c
JOIN "MaterialListVersion" v ON v."id" = c."materialVersionId"
WHERE v."productionAreaId" IS NOT NULL;

CREATE UNIQUE INDEX "ProcurementCompletionArea_procurementCompletionId_productionAreaId_key" ON "ProcurementCompletionArea"("procurementCompletionId", "productionAreaId");
CREATE UNIQUE INDEX "ProcurementCompletionArea_procurementCompletionId_materialVersionId_key" ON "ProcurementCompletionArea"("procurementCompletionId", "materialVersionId");

CREATE TABLE "Shipment" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "vehicle" TEXT NOT NULL,
  "deliveredAt" TIMESTAMP(3) NOT NULL,
  "pieceCount" INTEGER NOT NULL,
  "submittedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShipmentArea" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "productionAreaId" TEXT NOT NULL,
  "productionNumber" TEXT NOT NULL,
  "areaName" TEXT NOT NULL,
  CONSTRAINT "ShipmentArea_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Shipment" ("id", "orderId", "vehicle", "deliveredAt", "pieceCount", "submittedBy", "createdAt")
SELECT
  MD5('shipment:' || s."id")::uuid::text,
  s."orderId",
  COALESCE(NULLIF(s."payload"->>'vehicle', ''), '历史发货记录'),
  CASE WHEN COALESCE(s."payload"->>'deliveredAt', '') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}' THEN (s."payload"->>'deliveredAt')::timestamptz ELSE s."submittedAt" END,
  CASE WHEN COALESCE(s."payload"->>'pieceCount', '') ~ '^[0-9]+$' THEN (s."payload"->>'pieceCount')::integer ELSE 1 END,
  s."submittedBy",
  s."submittedAt"
FROM "StageSubmission" s
WHERE s."command" = 'RECORD_DELIVERY' AND s."status" <> 'DRAFT';

WITH first_delivery AS (
  SELECT DISTINCT ON (s."orderId") s."id" AS submission_id, s."orderId"
  FROM "StageSubmission" s
  WHERE s."command" = 'RECORD_DELIVERY' AND s."status" <> 'DRAFT'
  ORDER BY s."orderId", s."submittedAt", s."id"
)
INSERT INTO "ShipmentArea" ("id", "shipmentId", "productionAreaId", "productionNumber", "areaName")
SELECT
  MD5('shipment-area:' || f.submission_id || ':' || a."id")::uuid::text,
  MD5('shipment:' || f.submission_id)::uuid::text,
  a."id",
  a."productionNumber",
  a."name"
FROM first_delivery f
JOIN "ProductionArea" a ON a."orderId" = f."orderId";

CREATE INDEX "Shipment_orderId_deliveredAt_idx" ON "Shipment"("orderId", "deliveredAt");
CREATE UNIQUE INDEX "ShipmentArea_productionAreaId_key" ON "ShipmentArea"("productionAreaId");
CREATE INDEX "ShipmentArea_shipmentId_idx" ON "ShipmentArea"("shipmentId");

ALTER TABLE "ProductionArea" ADD CONSTRAINT "ProductionArea_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionProcess" ADD CONSTRAINT "ProductionProcess_productionAreaId_fkey" FOREIGN KEY ("productionAreaId") REFERENCES "ProductionArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionReport" ADD CONSTRAINT "ProductionReport_productionAreaId_fkey" FOREIGN KEY ("productionAreaId") REFERENCES "ProductionArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TechnicalSubmissionSet" ADD CONSTRAINT "TechnicalSubmissionSet_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TechnicalPackageVersion" ADD CONSTRAINT "TechnicalPackageVersion_productionAreaId_fkey" FOREIGN KEY ("productionAreaId") REFERENCES "ProductionArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TechnicalPackageVersion" ADD CONSTRAINT "TechnicalPackageVersion_submissionSetId_fkey" FOREIGN KEY ("submissionSetId") REFERENCES "TechnicalSubmissionSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MaterialImportBatch" ADD CONSTRAINT "MaterialImportBatch_productionAreaId_fkey" FOREIGN KEY ("productionAreaId") REFERENCES "ProductionArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaterialListVersion" ADD CONSTRAINT "MaterialListVersion_productionAreaId_fkey" FOREIGN KEY ("productionAreaId") REFERENCES "ProductionArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderMaterialCostVersion" ADD CONSTRAINT "OrderMaterialCostVersion_productionAreaId_fkey" FOREIGN KEY ("productionAreaId") REFERENCES "ProductionArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_productionAreaId_fkey" FOREIGN KEY ("productionAreaId") REFERENCES "ProductionArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcurementCompletionArea" ADD CONSTRAINT "ProcurementCompletionArea_procurementCompletionId_fkey" FOREIGN KEY ("procurementCompletionId") REFERENCES "ProcurementCompletion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcurementCompletionArea" ADD CONSTRAINT "ProcurementCompletionArea_productionAreaId_fkey" FOREIGN KEY ("productionAreaId") REFERENCES "ProductionArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcurementCompletionArea" ADD CONSTRAINT "ProcurementCompletionArea_materialVersionId_fkey" FOREIGN KEY ("materialVersionId") REFERENCES "MaterialListVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipmentArea" ADD CONSTRAINT "ShipmentArea_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipmentArea" ADD CONSTRAINT "ShipmentArea_productionAreaId_fkey" FOREIGN KEY ("productionAreaId") REFERENCES "ProductionArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

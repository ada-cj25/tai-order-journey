-- Remove the retired technical-reviewer account after moving its ownership and
-- review attribution to the first active order administrator.
DO $$
DECLARE
  target_admin TEXT;
  reviewer_ids TEXT[];
BEGIN
  SELECT "id" INTO target_admin FROM "Employee" WHERE "role" = 'ORDER_ADMIN' AND "active" = true ORDER BY "employeeNo" LIMIT 1;
  SELECT ARRAY_AGG("id") INTO reviewer_ids FROM "Employee" WHERE "role" = 'TECH_REVIEWER';
  IF reviewer_ids IS NOT NULL THEN
    IF target_admin IS NULL THEN RAISE EXCEPTION 'Cannot retire TECH_REVIEWER without an active ORDER_ADMIN'; END IF;
    UPDATE "Task" SET "ownerId" = target_admin, "department" = '订单中心', "title" = '技术审单' WHERE "ownerId" = ANY(reviewer_ids);
    UPDATE "OrderEvent" SET "actorId" = target_admin WHERE "actorId" = ANY(reviewer_ids);
    DELETE FROM "Notification" WHERE "employeeId" = ANY(reviewer_ids);
    UPDATE "TechnicalSubmissionSet" SET "reviewedBy" = target_admin WHERE "reviewedBy" = ANY(reviewer_ids);
    UPDATE "TechnicalPackageVersion" SET "reviewedBy" = target_admin WHERE "reviewedBy" = ANY(reviewer_ids);
    UPDATE "OutsourceRequirementVersion" SET "reviewedBy" = target_admin WHERE "reviewedBy" = ANY(reviewer_ids);
    UPDATE "MaterialListVersion" SET "releasedBy" = target_admin WHERE "releasedBy" = ANY(reviewer_ids);
    UPDATE "StageSubmission" SET "submittedBy" = target_admin WHERE "submittedBy" = ANY(reviewer_ids);
    UPDATE "StageSubmission" SET "reviewedBy" = target_admin WHERE "reviewedBy" = ANY(reviewer_ids);
    UPDATE "MaterialCostPriceVersion" SET "createdBy" = target_admin WHERE "createdBy" = ANY(reviewer_ids);
    UPDATE "OrderMaterialCostVersion" SET "recalculatedBy" = target_admin WHERE "recalculatedBy" = ANY(reviewer_ids);
    DELETE FROM "Employee" WHERE "id" = ANY(reviewer_ids);
  END IF;
END $$;

ALTER TABLE "Employee" ALTER COLUMN "role" TYPE TEXT USING "role"::TEXT;
DROP TYPE "Role";
CREATE TYPE "Role" AS ENUM ('CHAIRMAN', 'ORDER_ADMIN', 'FINANCE', 'SALES', 'DESIGNER', 'TECHNICAL', 'WAREHOUSE', 'PROCUREMENT', 'WORKSHOP', 'INSTALLER', 'AFTERSALES');
ALTER TABLE "Employee" ALTER COLUMN "role" TYPE "Role" USING "role"::"Role";

ALTER TABLE "TechnicalPackageVersion"
ADD COLUMN "firstBatchInstallationFee" DECIMAL(16,2);

CREATE TABLE "WorkshopCostRateVersion" (
  "id" TEXT NOT NULL,
  "workshop" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "unitPrice" DECIMAL(16,4) NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkshopCostRateVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkshopCostRateVersion_workshop_version_key" ON "WorkshopCostRateVersion"("workshop", "version");
CREATE INDEX "WorkshopCostRateVersion_workshop_effectiveAt_idx" ON "WorkshopCostRateVersion"("workshop", "effectiveAt");

INSERT INTO "WorkshopCostRateVersion" ("id", "workshop", "version", "unitPrice", "createdBy", "note") VALUES
  ('workshop-rate-panel-v1', 'PANEL', 1, 12.0000, 'SYSTEM', '用户确认初始综合单价'),
  ('workshop-rate-assembly-v1', 'ASSEMBLY', 1, 3.4000, 'SYSTEM', '用户确认初始综合单价'),
  ('workshop-rate-wood-v1', 'WOOD', 1, 80.0000, 'SYSTEM', '用户确认初始综合单价'),
  ('workshop-rate-paint-v1', 'PAINT', 1, 60.0000, 'SYSTEM', '用户确认初始综合单价');

CREATE TABLE "OrderWorkshopCostVersion" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "productionAreaId" TEXT NOT NULL,
  "technicalPackageId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "totalCost" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderWorkshopCostVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrderWorkshopCostVersion_technicalPackageId_key" ON "OrderWorkshopCostVersion"("technicalPackageId");
CREATE UNIQUE INDEX "OrderWorkshopCostVersion_productionAreaId_version_key" ON "OrderWorkshopCostVersion"("productionAreaId", "version");
CREATE INDEX "OrderWorkshopCostVersion_orderId_createdAt_idx" ON "OrderWorkshopCostVersion"("orderId", "createdAt");

CREATE TABLE "OrderWorkshopCostLine" (
  "id" TEXT NOT NULL,
  "costVersionId" TEXT NOT NULL,
  "workshop" TEXT NOT NULL,
  "workshopLabel" TEXT NOT NULL,
  "quantity" DECIMAL(12,3) NOT NULL,
  "unit" TEXT NOT NULL DEFAULT '㎡',
  "unitPriceSnapshot" DECIMAL(16,4) NOT NULL,
  "rateVersionId" TEXT NOT NULL,
  "lineTotal" DECIMAL(16,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderWorkshopCostLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrderWorkshopCostLine_costVersionId_workshop_key" ON "OrderWorkshopCostLine"("costVersionId", "workshop");
CREATE INDEX "OrderWorkshopCostLine_rateVersionId_idx" ON "OrderWorkshopCostLine"("rateVersionId");

ALTER TABLE "OrderWorkshopCostVersion" ADD CONSTRAINT "OrderWorkshopCostVersion_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderWorkshopCostVersion" ADD CONSTRAINT "OrderWorkshopCostVersion_productionAreaId_fkey" FOREIGN KEY ("productionAreaId") REFERENCES "ProductionArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderWorkshopCostVersion" ADD CONSTRAINT "OrderWorkshopCostVersion_technicalPackageId_fkey" FOREIGN KEY ("technicalPackageId") REFERENCES "TechnicalPackageVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderWorkshopCostLine" ADD CONSTRAINT "OrderWorkshopCostLine_costVersionId_fkey" FOREIGN KEY ("costVersionId") REFERENCES "OrderWorkshopCostVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderWorkshopCostLine" ADD CONSTRAINT "OrderWorkshopCostLine_rateVersionId_fkey" FOREIGN KEY ("rateVersionId") REFERENCES "WorkshopCostRateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing approved packages receive a one-time workshop-rate snapshot. Historical
-- first-batch installation fees remain unknown and must be explicitly backfilled by
-- the order administrator when the first new shipment batch is recorded.
WITH latest_package AS (
  SELECT DISTINCT ON ("productionAreaId") "id", "orderId", "productionAreaId"
  FROM "TechnicalPackageVersion"
  WHERE "status" = 'APPROVED' AND "productionAreaId" IS NOT NULL
    AND "assemblyPlanQty" > 0
    AND (NOT "panelEnabled" OR "panelPlanQty" > 0)
    AND (NOT "woodPaintEnabled" OR ("woodPlanQty" > 0 AND "paintPlanQty" > 0))
  ORDER BY "productionAreaId", "version" DESC
)
INSERT INTO "OrderWorkshopCostVersion" ("id", "orderId", "productionAreaId", "technicalPackageId", "version")
SELECT MD5('workshop-cost:' || "id"), "orderId", "productionAreaId", "id", 1 FROM latest_package;

INSERT INTO "OrderWorkshopCostLine" ("id", "costVersionId", "workshop", "workshopLabel", "quantity", "unitPriceSnapshot", "rateVersionId", "lineTotal")
SELECT
  MD5('workshop-cost-line:' || cost."id" || ':' || plan."workshop"),
  cost."id", plan."workshop", plan."label", plan."quantity", rate."unitPrice", rate."id",
  ROUND(plan."quantity" * rate."unitPrice", 2)
FROM "OrderWorkshopCostVersion" cost
JOIN "TechnicalPackageVersion" package ON package."id" = cost."technicalPackageId"
CROSS JOIN LATERAL (VALUES
  ('PANEL', '板式', package."panelPlanQty", package."panelEnabled"),
  ('WOOD', '实木', package."woodPlanQty", package."woodPaintEnabled"),
  ('PAINT', '油漆', package."paintPlanQty", package."woodPaintEnabled"),
  ('ASSEMBLY', '组装', package."assemblyPlanQty", true)
) AS plan("workshop", "label", "quantity", "enabled")
JOIN "WorkshopCostRateVersion" rate ON rate."workshop" = plan."workshop" AND rate."version" = 1
WHERE plan."enabled" = true;

UPDATE "OrderWorkshopCostVersion" cost SET "totalCost" = summary."total"
FROM (SELECT "costVersionId", SUM("lineTotal") AS "total" FROM "OrderWorkshopCostLine" GROUP BY "costVersionId") summary
WHERE cost."id" = summary."costVersionId";

ALTER TABLE "Shipment"
ADD COLUMN "transportCost" DECIMAL(16,2),
ADD COLUMN "installedAt" TIMESTAMP(3),
ADD COLUMN "installer" TEXT,
ADD COLUMN "issueConclusion" TEXT,
ADD COLUMN "installationPhotoAttachmentIds" JSONB,
ADD COLUMN "installationCompletedBy" TEXT;

DROP INDEX IF EXISTS "ShipmentArea_productionAreaId_key";
ALTER TABLE "ShipmentArea"
ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "pieceCount" INTEGER,
ADD COLUMN "isFinalBatch" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "installationFee" DECIMAL(16,2),
ADD COLUMN "installationFeeSource" TEXT,
ADD COLUMN "installationFeeRecordedBy" TEXT;

UPDATE "ShipmentArea" line SET "pieceCount" = shipment."pieceCount"
FROM "Shipment" shipment
WHERE shipment."id" = line."shipmentId"
  AND (SELECT COUNT(*) FROM "ShipmentArea" sibling WHERE sibling."shipmentId" = shipment."id") = 1;

-- The retired workflow stored installation completion once at order level. Mark
-- every historical manufactured batch installed so completed orders keep their
-- fulfillment truth; its previously unrecorded transport cost remains pending.
WITH legacy_installation AS (
  SELECT DISTINCT ON ("orderId")
    "orderId",
    CASE
      WHEN COALESCE("payload"->>'installedAt', '') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}' THEN ("payload"->>'installedAt')::timestamptz
      ELSE "submittedAt"
    END AS "installedAt",
    NULLIF("payload"->>'installer', '') AS "installer",
    NULLIF("payload"->>'issueConclusion', '') AS "issueConclusion",
    "payload"->'photoAttachmentIds' AS "photoAttachmentIds",
    "submittedBy"
  FROM "StageSubmission"
  WHERE "command" = 'COMPLETE_INSTALLATION' AND "status" <> 'DRAFT'
  ORDER BY "orderId", "submittedAt" DESC, "id" DESC
)
UPDATE "Shipment" shipment SET
  "installedAt" = legacy."installedAt",
  "installer" = legacy."installer",
  "issueConclusion" = legacy."issueConclusion",
  "installationPhotoAttachmentIds" = legacy."photoAttachmentIds",
  "installationCompletedBy" = legacy."submittedBy"
FROM legacy_installation legacy
WHERE shipment."orderId" = legacy."orderId" AND shipment."kind" = 'MANUFACTURED';

ALTER TABLE "ShipmentArea" ALTER COLUMN "isFinalBatch" SET DEFAULT false;

CREATE UNIQUE INDEX "ShipmentArea_shipmentId_productionAreaId_key" ON "ShipmentArea"("shipmentId", "productionAreaId");
CREATE UNIQUE INDEX "ShipmentArea_productionAreaId_sequence_key" ON "ShipmentArea"("productionAreaId", "sequence");

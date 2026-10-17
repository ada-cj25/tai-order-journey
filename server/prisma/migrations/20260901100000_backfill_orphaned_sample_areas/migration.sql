-- Some preserved local acceptance samples intentionally had technical/material
-- facts before an Order.productionNumber existed. Give those facts a stable area
-- too, using their reviewed workbook source number when present. These are test
-- records and do not touch ProductionNumberSequence.
WITH candidates AS (
  SELECT DISTINCT o."id", o."trackingSerial", o."salesId", o."createdAt", o."updatedAt",
    COALESCE(
      (SELECT b."sourceProductionNumber" FROM "MaterialImportBatch" b WHERE b."orderId" = o."id" AND b."sourceProductionNumber" IS NOT NULL ORDER BY b."createdAt" LIMIT 1),
      'TEST-AREA-' || REGEXP_REPLACE(o."trackingSerial", '[^A-Za-z0-9-]', '-', 'g') || '-01'
    ) AS production_number
  FROM "Order" o
  WHERE NOT EXISTS (SELECT 1 FROM "ProductionArea" a WHERE a."orderId" = o."id")
    AND (
      EXISTS (SELECT 1 FROM "TechnicalPackageVersion" p WHERE p."orderId" = o."id") OR
      EXISTS (SELECT 1 FROM "MaterialImportBatch" b WHERE b."orderId" = o."id") OR
      EXISTS (SELECT 1 FROM "MaterialListVersion" v WHERE v."orderId" = o."id") OR
      EXISTS (SELECT 1 FROM "OrderMaterialCostVersion" c WHERE c."orderId" = o."id") OR
      EXISTS (SELECT 1 FROM "ProductionProcess" p WHERE p."orderId" = o."id")
    )
)
INSERT INTO "ProductionArea" (
  "id", "orderId", "name", "sequence", "productionNumber", "status", "lockedAt",
  "createdBy", "createdAt", "updatedAt"
)
SELECT
  MD5('production-area:orphaned-sample:' || c."id")::uuid::text,
  c."id",
  '历史验收样例区域',
  1,
  c.production_number,
  CASE WHEN EXISTS (SELECT 1 FROM "MaterialListVersion" v WHERE v."orderId" = c."id" AND v."status" <> 'CANCELLED') THEN 'TECHNICAL_APPROVED' ELSE 'LOCKED' END,
  c."createdAt",
  c."salesId",
  c."createdAt",
  c."updatedAt"
FROM candidates c;

UPDATE "ProductionProcess" x SET "productionAreaId" = a."id" FROM "ProductionArea" a WHERE x."productionAreaId" IS NULL AND a."orderId" = x."orderId";
UPDATE "ProductionReport" x SET "productionAreaId" = a."id" FROM "ProductionArea" a WHERE x."productionAreaId" IS NULL AND a."orderId" = x."orderId";
UPDATE "TechnicalPackageVersion" x SET "productionAreaId" = a."id" FROM "ProductionArea" a WHERE x."productionAreaId" IS NULL AND a."orderId" = x."orderId";
UPDATE "MaterialImportBatch" x SET "productionAreaId" = a."id" FROM "ProductionArea" a WHERE x."productionAreaId" IS NULL AND a."orderId" = x."orderId";
UPDATE "MaterialListVersion" x SET "productionAreaId" = a."id" FROM "ProductionArea" a WHERE x."productionAreaId" IS NULL AND a."orderId" = x."orderId";
UPDATE "OrderMaterialCostVersion" x SET "productionAreaId" = a."id" FROM "ProductionArea" a WHERE x."productionAreaId" IS NULL AND a."orderId" = x."orderId";
UPDATE "Attachment" x
SET "productionAreaId" = a."id"
FROM "ProductionArea" a
WHERE x."productionAreaId" IS NULL AND a."orderId" = x."orderId"
  AND x."category" IN ('HAIXUN_EXPORT', 'DECOMPOSITION_SHEET', 'HARDWARE_MATERIALS', 'PAINT_WOOD', 'SOLID_WOOD_DOOR', 'VENEER_DOOR');

UPDATE "Order" o SET "technicalAreasLockedAt" = a."lockedAt"
FROM "ProductionArea" a
WHERE o."id" = a."orderId" AND o."technicalAreasLockedAt" IS NULL;

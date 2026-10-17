ALTER TABLE "ProductionProcess" ADD COLUMN "metricMode" TEXT NOT NULL DEFAULT 'AREA_QUANTITY';

UPDATE "ProductionProcess"
SET "metricMode" = CASE
  WHEN "processCode" = 'ASSEMBLY-02' THEN 'REFERENCE_CONFIRMATION'
  WHEN "processCode" = 'ASSEMBLY-03' THEN 'PACKAGE_COUNT'
  WHEN "processCode" = 'ASSEMBLY-04' THEN 'MILESTONE'
  ELSE 'AREA_QUANTITY'
END;

UPDATE "ProductionProcess"
SET "note" = concat_ws(' · ', NULLIF("note", ''), '旧版按平方米的未完成进度已存档，请按新包件口径重新办理'),
    "plannedQty" = 1,
    "completedQty" = 0,
    "status" = 'PENDING',
    "startedAt" = NULL,
    "completedAt" = NULL
WHERE "processCode" IN ('ASSEMBLY-02', 'ASSEMBLY-03', 'ASSEMBLY-04')
  AND "status" <> 'COMPLETE';

ALTER TABLE "Shipment" ALTER COLUMN "pieceCount" DROP NOT NULL;
ALTER TABLE "Shipment" ADD COLUMN "countBasis" TEXT NOT NULL DEFAULT 'LEGACY_MANUAL';
ALTER TABLE "Shipment" ALTER COLUMN "countBasis" SET DEFAULT 'NOT_RECORDED';

CREATE TABLE "PackageCountSource" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "productionAreaId" TEXT,
  "outsourceProductLineId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "finalizedBy" TEXT,
  "finalizedAt" TIMESTAMP(3),
  "handoffConfirmedBy" TEXT,
  "handoffConfirmedAt" TIMESTAMP(3),
  "reopenedAt" TIMESTAMP(3),
  "reopenReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PackageCountSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PackageCountEntry" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "recordedBy" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voidedAt" TIMESTAMP(3),
  "voidedBy" TEXT,
  "voidReason" TEXT,
  CONSTRAINT "PackageCountEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PackageCountSource_sourceKey_key" ON "PackageCountSource"("sourceKey");
CREATE INDEX "PackageCountSource_orderId_kind_status_idx" ON "PackageCountSource"("orderId", "kind", "status");
CREATE INDEX "PackageCountSource_productionAreaId_idx" ON "PackageCountSource"("productionAreaId");
CREATE INDEX "PackageCountSource_outsourceProductLineId_idx" ON "PackageCountSource"("outsourceProductLineId");
CREATE INDEX "PackageCountEntry_sourceId_recordedAt_idx" ON "PackageCountEntry"("sourceId", "recordedAt");

ALTER TABLE "PackageCountSource" ADD CONSTRAINT "PackageCountSource_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PackageCountSource" ADD CONSTRAINT "PackageCountSource_productionAreaId_fkey" FOREIGN KEY ("productionAreaId") REFERENCES "ProductionArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PackageCountSource" ADD CONSTRAINT "PackageCountSource_outsourceProductLineId_fkey" FOREIGN KEY ("outsourceProductLineId") REFERENCES "OutsourceProductLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PackageCountEntry" ADD CONSTRAINT "PackageCountEntry_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "PackageCountSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

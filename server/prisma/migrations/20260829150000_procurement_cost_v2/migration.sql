-- CreateEnum
CREATE TYPE "MaterialTemplateType" AS ENUM ('HARDWARE_MATERIALS', 'PAINT_WOOD', 'SOLID_WOOD_DOOR', 'VENEER_DOOR');

-- CreateEnum
CREATE TYPE "MaterialCostStatus" AS ENUM ('WAITING_PRICE', 'COMPLETE');

-- Each technical package now has four template-specific import batches.
DROP INDEX "MaterialImportBatch_technicalPackageId_key";

ALTER TABLE "MaterialImportBatch" ADD COLUMN "parserVersion" TEXT NOT NULL DEFAULT 'V1',
ADD COLUMN "templateType" "MaterialTemplateType" NOT NULL DEFAULT 'HARDWARE_MATERIALS';

ALTER TABLE "MaterialLine" ADD COLUMN "parserVersion" TEXT NOT NULL DEFAULT 'V1',
ADD COLUMN "sourceSubRow" TEXT NOT NULL DEFAULT 'A',
ADD COLUMN "templateType" "MaterialTemplateType" NOT NULL DEFAULT 'HARDWARE_MATERIALS';

ALTER TABLE "Order" ADD COLUMN "materialCostStatus" "MaterialCostStatus",
ADD COLUMN "materialCostSubtotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN "materialCostTotal" DECIMAL(16,2),
ADD COLUMN "procurementCompletedAt" TIMESTAMP(3),
ADD COLUMN "procurementCompletedBy" TEXT,
ADD COLUMN "procurementDelayDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "procurementDueAt" TIMESTAMP(3),
ADD COLUMN "procurementStartedAt" TIMESTAMP(3);

ALTER TABLE "TechnicalPackageVersion" ADD COLUMN "assemblyPlanQty" DECIMAL(12,3) NOT NULL DEFAULT 1,
ADD COLUMN "paintPlanQty" DECIMAL(12,3) NOT NULL DEFAULT 1,
ADD COLUMN "panelPlanQty" DECIMAL(12,3) NOT NULL DEFAULT 1,
ADD COLUMN "woodPlanQty" DECIMAL(12,3) NOT NULL DEFAULT 1;

CREATE TABLE "MaterialCostItem" (
    "id" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "specification" TEXT,
    "specificationKey" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "status" "MaterialCostStatus" NOT NULL DEFAULT 'WAITING_PRICE',
    "firstSource" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPriceAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MaterialCostItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaterialCostPriceVersion" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "unitPrice" DECIMAL(16,4) NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaterialCostPriceVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderMaterialCostVersion" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "materialVersionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "MaterialCostStatus" NOT NULL DEFAULT 'WAITING_PRICE',
    "pricedSubtotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(16,2),
    "missingPriceCount" INTEGER NOT NULL DEFAULT 0,
    "recalculatedBy" TEXT,
    "recalculatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrderMaterialCostVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderMaterialCostLine" (
    "id" TEXT NOT NULL,
    "costVersionId" TEXT NOT NULL,
    "costItemId" TEXT NOT NULL,
    "quantity" DECIMAL(16,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPriceSnapshot" DECIMAL(16,4),
    "priceVersionId" TEXT,
    "lineTotal" DECIMAL(16,2),
    "sourceRefs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrderMaterialCostLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProcurementCompletion" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "materialVersionId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "completedBy" TEXT NOT NULL,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "attested" BOOLEAN NOT NULL DEFAULT true,
    "costComplete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcurementCompletion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaterialCostItem_status_lastSeenAt_idx" ON "MaterialCostItem"("status", "lastSeenAt");
CREATE UNIQUE INDEX "MaterialCostItem_normalizedName_specificationKey_unit_key" ON "MaterialCostItem"("normalizedName", "specificationKey", "unit");
CREATE INDEX "MaterialCostPriceVersion_itemId_effectiveAt_idx" ON "MaterialCostPriceVersion"("itemId", "effectiveAt");
CREATE UNIQUE INDEX "MaterialCostPriceVersion_itemId_version_key" ON "MaterialCostPriceVersion"("itemId", "version");
CREATE UNIQUE INDEX "OrderMaterialCostVersion_materialVersionId_key" ON "OrderMaterialCostVersion"("materialVersionId");
CREATE INDEX "OrderMaterialCostVersion_orderId_createdAt_idx" ON "OrderMaterialCostVersion"("orderId", "createdAt");
CREATE UNIQUE INDEX "OrderMaterialCostVersion_orderId_version_key" ON "OrderMaterialCostVersion"("orderId", "version");
CREATE INDEX "OrderMaterialCostLine_costItemId_unitPriceSnapshot_idx" ON "OrderMaterialCostLine"("costItemId", "unitPriceSnapshot");
CREATE UNIQUE INDEX "OrderMaterialCostLine_costVersionId_costItemId_key" ON "OrderMaterialCostLine"("costVersionId", "costItemId");
CREATE UNIQUE INDEX "ProcurementCompletion_orderId_key" ON "ProcurementCompletion"("orderId");
CREATE UNIQUE INDEX "ProcurementCompletion_materialVersionId_key" ON "ProcurementCompletion"("materialVersionId");
CREATE INDEX "ProcurementCompletion_dueAt_completedAt_idx" ON "ProcurementCompletion"("dueAt", "completedAt");
CREATE UNIQUE INDEX "MaterialImportBatch_technicalPackageId_templateType_key" ON "MaterialImportBatch"("technicalPackageId", "templateType");

ALTER TABLE "MaterialCostPriceVersion" ADD CONSTRAINT "MaterialCostPriceVersion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MaterialCostItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderMaterialCostVersion" ADD CONSTRAINT "OrderMaterialCostVersion_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderMaterialCostVersion" ADD CONSTRAINT "OrderMaterialCostVersion_materialVersionId_fkey" FOREIGN KEY ("materialVersionId") REFERENCES "MaterialListVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderMaterialCostLine" ADD CONSTRAINT "OrderMaterialCostLine_costVersionId_fkey" FOREIGN KEY ("costVersionId") REFERENCES "OrderMaterialCostVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderMaterialCostLine" ADD CONSTRAINT "OrderMaterialCostLine_costItemId_fkey" FOREIGN KEY ("costItemId") REFERENCES "MaterialCostItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcurementCompletion" ADD CONSTRAINT "ProcurementCompletion_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcurementCompletion" ADD CONSTRAINT "ProcurementCompletion_materialVersionId_fkey" FOREIGN KEY ("materialVersionId") REFERENCES "MaterialListVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

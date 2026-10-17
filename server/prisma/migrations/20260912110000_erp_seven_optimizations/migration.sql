ALTER TABLE "TechnicalPackageVersion"
ADD COLUMN "veneerRequired" BOOLEAN NOT NULL DEFAULT false;

-- Existing technical packages were created from the historical template that
-- always contained WOOD-03. Preserve that applicability and all report history.
UPDATE "TechnicalPackageVersion" package
SET "veneerRequired" = true
WHERE package."woodPaintEnabled" = true
  AND EXISTS (
    SELECT 1
    FROM "ProductionProcess" process
    WHERE process."orderId" = package."orderId"
      AND process."productionAreaId" = package."productionAreaId"
      AND process."processCode" = 'WOOD-03'
  );

CREATE TABLE "AfterSalesCostBatch" (
  "id" TEXT NOT NULL,
  "afterSalesId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "incurredOn" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(16,2) NOT NULL,
  "description" TEXT NOT NULL,
  "attachmentIds" JSONB,
  "recordedBy" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voidedAt" TIMESTAMP(3),
  "voidedBy" TEXT,
  "voidReason" TEXT,
  CONSTRAINT "AfterSalesCostBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AfterSalesCostBatch_afterSalesId_recordedAt_idx" ON "AfterSalesCostBatch"("afterSalesId", "recordedAt");
CREATE INDEX "AfterSalesCostBatch_orderId_voidedAt_idx" ON "AfterSalesCostBatch"("orderId", "voidedAt");

ALTER TABLE "AfterSalesCostBatch"
ADD CONSTRAINT "AfterSalesCostBatch_afterSalesId_fkey"
FOREIGN KEY ("afterSalesId") REFERENCES "AfterSalesCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AfterSalesCostBatch"
ADD CONSTRAINT "AfterSalesCostBatch_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OutsourceProductCostVersion" (
  "id" TEXT NOT NULL,
  "productLineId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "unitPrice" DECIMAL(16,4) NOT NULL,
  "createdBy" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutsourceProductCostVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutsourceProductCostVersion_productLineId_version_key" ON "OutsourceProductCostVersion"("productLineId", "version");
CREATE INDEX "OutsourceProductCostVersion_productLineId_createdAt_idx" ON "OutsourceProductCostVersion"("productLineId", "createdAt");
ALTER TABLE "OutsourceProductCostVersion" ADD CONSTRAINT "OutsourceProductCostVersion_productLineId_fkey" FOREIGN KEY ("productLineId") REFERENCES "OutsourceProductLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

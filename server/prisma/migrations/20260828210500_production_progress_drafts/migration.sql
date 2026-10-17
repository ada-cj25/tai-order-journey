CREATE TABLE "ProductionProcess" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "workshop" TEXT NOT NULL,
    "workshopLabel" TEXT NOT NULL,
    "processCode" TEXT NOT NULL,
    "processName" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "plannedQty" DECIMAL(12,3) NOT NULL,
    "completedQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT '件',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastReportedAt" TIMESTAMP(3),
    "note" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionProcess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductionReport" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productionProcessId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "completedQty" DECIMAL(12,3) NOT NULL,
    "previousQty" DECIMAL(12,3) NOT NULL,
    "note" TEXT,
    "attachmentIds" JSONB,
    "reportedBy" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionProcess_orderId_workshop_processCode_key" ON "ProductionProcess"("orderId", "workshop", "processCode");
CREATE INDEX "ProductionProcess_orderId_workshop_sequence_idx" ON "ProductionProcess"("orderId", "workshop", "sequence");
CREATE INDEX "ProductionReport_orderId_reportedAt_idx" ON "ProductionReport"("orderId", "reportedAt");
CREATE INDEX "ProductionReport_productionProcessId_reportedAt_idx" ON "ProductionReport"("productionProcessId", "reportedAt");

ALTER TABLE "ProductionProcess" ADD CONSTRAINT "ProductionProcess_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionReport" ADD CONSTRAINT "ProductionReport_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionReport" ADD CONSTRAINT "ProductionReport_productionProcessId_fkey" FOREIGN KEY ("productionProcessId") REFERENCES "ProductionProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

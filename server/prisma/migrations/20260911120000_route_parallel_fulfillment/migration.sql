CREATE TYPE "ProductionExecutionMode" AS ENUM ('AREA_LEGACY', 'ROUTE_V2');
CREATE TYPE "ProductionRouteKind" AS ENUM ('PANEL', 'WOOD_PAINT');

ALTER TABLE "Order"
  ADD COLUMN "productionExecutionMode" "ProductionExecutionMode" NOT NULL DEFAULT 'AREA_LEGACY';
ALTER TABLE "Order" ALTER COLUMN "productionExecutionMode" SET DEFAULT 'ROUTE_V2';

ALTER TABLE "TechnicalPackageVersion"
  ADD COLUMN "panelAssemblyPlanQty" DECIMAL(12,3),
  ADD COLUMN "woodPaintAssemblyPlanQty" DECIMAL(12,3);
ALTER TABLE "OrderWorkshopCostLine" ADD COLUMN "routeBreakdown" JSONB;

CREATE TABLE "ProcurementRouteGate" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "submissionSetId" TEXT NOT NULL,
  "kind" "ProductionRouteKind" NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "completedBy" TEXT,
  "delayDays" INTEGER NOT NULL DEFAULT 0,
  "attested" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProcurementRouteGate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductionRoute" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "productionAreaId" TEXT NOT NULL,
  "technicalPackageId" TEXT NOT NULL,
  "procurementRouteGateId" TEXT NOT NULL,
  "kind" "ProductionRouteKind" NOT NULL,
  "assemblyPlanQty" DECIMAL(12,3) NOT NULL,
  "releasedAt" TIMESTAMP(3),
  "productionCompletedAt" TIMESTAMP(3),
  "shippedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductionRoute_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProductionProcess" ADD COLUMN "productionRouteId" TEXT;
ALTER TABLE "PackageCountSource" ADD COLUMN "productionRouteId" TEXT;

CREATE TABLE "ShipmentRouteLine" (
  "id" TEXT NOT NULL,
  "shipmentAreaId" TEXT NOT NULL,
  "productionRouteId" TEXT NOT NULL,
  "routeKind" "ProductionRouteKind" NOT NULL,
  "routeLabel" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShipmentRouteLine_pkey" PRIMARY KEY ("id")
);

DROP INDEX IF EXISTS "ProductionProcess_productionAreaId_workshop_processCode_key";
CREATE UNIQUE INDEX "ProductionProcess_productionRouteId_workshop_processCode_key" ON "ProductionProcess"("productionRouteId", "workshop", "processCode");
CREATE INDEX "ProductionProcess_productionRouteId_workshop_sequence_idx" ON "ProductionProcess"("productionRouteId", "workshop", "sequence");
CREATE UNIQUE INDEX "ProcurementRouteGate_submissionSetId_kind_key" ON "ProcurementRouteGate"("submissionSetId", "kind");
CREATE INDEX "ProcurementRouteGate_orderId_completedAt_dueAt_idx" ON "ProcurementRouteGate"("orderId", "completedAt", "dueAt");
CREATE UNIQUE INDEX "ProductionRoute_technicalPackageId_kind_key" ON "ProductionRoute"("technicalPackageId", "kind");
CREATE INDEX "ProductionRoute_orderId_kind_releasedAt_idx" ON "ProductionRoute"("orderId", "kind", "releasedAt");
CREATE INDEX "ProductionRoute_productionAreaId_kind_cancelledAt_idx" ON "ProductionRoute"("productionAreaId", "kind", "cancelledAt");
CREATE INDEX "PackageCountSource_productionRouteId_idx" ON "PackageCountSource"("productionRouteId");
CREATE UNIQUE INDEX "ShipmentRouteLine_productionRouteId_key" ON "ShipmentRouteLine"("productionRouteId");
CREATE INDEX "ShipmentRouteLine_shipmentAreaId_idx" ON "ShipmentRouteLine"("shipmentAreaId");

ALTER TABLE "ProcurementRouteGate" ADD CONSTRAINT "ProcurementRouteGate_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcurementRouteGate" ADD CONSTRAINT "ProcurementRouteGate_submissionSetId_fkey" FOREIGN KEY ("submissionSetId") REFERENCES "TechnicalSubmissionSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionRoute" ADD CONSTRAINT "ProductionRoute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionRoute" ADD CONSTRAINT "ProductionRoute_productionAreaId_fkey" FOREIGN KEY ("productionAreaId") REFERENCES "ProductionArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionRoute" ADD CONSTRAINT "ProductionRoute_technicalPackageId_fkey" FOREIGN KEY ("technicalPackageId") REFERENCES "TechnicalPackageVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionRoute" ADD CONSTRAINT "ProductionRoute_procurementRouteGateId_fkey" FOREIGN KEY ("procurementRouteGateId") REFERENCES "ProcurementRouteGate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionProcess" ADD CONSTRAINT "ProductionProcess_productionRouteId_fkey" FOREIGN KEY ("productionRouteId") REFERENCES "ProductionRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PackageCountSource" ADD CONSTRAINT "PackageCountSource_productionRouteId_fkey" FOREIGN KEY ("productionRouteId") REFERENCES "ProductionRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShipmentRouteLine" ADD CONSTRAINT "ShipmentRouteLine_shipmentAreaId_fkey" FOREIGN KEY ("shipmentAreaId") REFERENCES "ShipmentArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipmentRouteLine" ADD CONSTRAINT "ShipmentRouteLine_productionRouteId_fkey" FOREIGN KEY ("productionRouteId") REFERENCES "ProductionRoute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

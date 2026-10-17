CREATE TYPE "OutsourceRequirementMode" AS ENUM ('UNDECLARED', 'NONE', 'REQUIRED', 'LEGACY_EXEMPT');
CREATE TYPE "OutsourceRequirementStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "ShipmentKind" AS ENUM ('MANUFACTURED', 'OUTSOURCED');

ALTER TABLE "Order" ADD COLUMN "outsourceRequirementMode" "OutsourceRequirementMode" NOT NULL DEFAULT 'UNDECLARED';
UPDATE "Order" SET "outsourceRequirementMode" = 'LEGACY_EXEMPT';

ALTER TABLE "Shipment" ADD COLUMN "kind" "ShipmentKind" NOT NULL DEFAULT 'MANUFACTURED';

CREATE TABLE "OutsourceRequirementVersion" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "submissionSetId" TEXT,
  "version" INTEGER NOT NULL,
  "status" "OutsourceRequirementStatus" NOT NULL DEFAULT 'DRAFT',
  "declaresNone" BOOLEAN NOT NULL DEFAULT false,
  "submittedBy" TEXT NOT NULL,
  "reviewedBy" TEXT,
  "reviewComment" TEXT,
  "submittedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutsourceRequirementVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutsourceProductLine" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "requirementVersionId" TEXT NOT NULL,
  "presetCode" TEXT,
  "name" TEXT NOT NULL,
  "plannedQty" DECIMAL(12,3) NOT NULL,
  "unit" TEXT NOT NULL DEFAULT '件',
  "usageArea" TEXT,
  "note" TEXT,
  "sequence" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutsourceProductLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutsourceArrival" (
  "id" TEXT NOT NULL,
  "productLineId" TEXT NOT NULL,
  "quantity" DECIMAL(12,3) NOT NULL,
  "arrivedOn" TIMESTAMP(3) NOT NULL,
  "confirmedBy" TEXT NOT NULL,
  "voidedAt" TIMESTAMP(3),
  "voidedBy" TEXT,
  "voidReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutsourceArrival_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutsourceShipmentLine" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "productLineId" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "plannedQty" DECIMAL(12,3) NOT NULL,
  "unit" TEXT NOT NULL,
  "usageArea" TEXT,
  CONSTRAINT "OutsourceShipmentLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutsourceRequirementVersion_submissionSetId_key" ON "OutsourceRequirementVersion"("submissionSetId");
CREATE UNIQUE INDEX "OutsourceRequirementVersion_orderId_version_key" ON "OutsourceRequirementVersion"("orderId", "version");
CREATE INDEX "OutsourceRequirementVersion_orderId_status_createdAt_idx" ON "OutsourceRequirementVersion"("orderId", "status", "createdAt");
CREATE UNIQUE INDEX "OutsourceProductLine_requirementVersionId_sequence_key" ON "OutsourceProductLine"("requirementVersionId", "sequence");
CREATE INDEX "OutsourceProductLine_orderId_sequence_idx" ON "OutsourceProductLine"("orderId", "sequence");
CREATE INDEX "OutsourceArrival_productLineId_arrivedOn_idx" ON "OutsourceArrival"("productLineId", "arrivedOn");
CREATE UNIQUE INDEX "OutsourceShipmentLine_productLineId_key" ON "OutsourceShipmentLine"("productLineId");
CREATE INDEX "OutsourceShipmentLine_shipmentId_idx" ON "OutsourceShipmentLine"("shipmentId");

ALTER TABLE "OutsourceRequirementVersion" ADD CONSTRAINT "OutsourceRequirementVersion_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutsourceRequirementVersion" ADD CONSTRAINT "OutsourceRequirementVersion_submissionSetId_fkey" FOREIGN KEY ("submissionSetId") REFERENCES "TechnicalSubmissionSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OutsourceProductLine" ADD CONSTRAINT "OutsourceProductLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutsourceProductLine" ADD CONSTRAINT "OutsourceProductLine_requirementVersionId_fkey" FOREIGN KEY ("requirementVersionId") REFERENCES "OutsourceRequirementVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutsourceArrival" ADD CONSTRAINT "OutsourceArrival_productLineId_fkey" FOREIGN KEY ("productLineId") REFERENCES "OutsourceProductLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutsourceShipmentLine" ADD CONSTRAINT "OutsourceShipmentLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutsourceShipmentLine" ADD CONSTRAINT "OutsourceShipmentLine_productLineId_fkey" FOREIGN KEY ("productLineId") REFERENCES "OutsourceProductLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


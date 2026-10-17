ALTER TABLE "ShipmentRouteLine"
ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "isFinalBatch" BOOLEAN NOT NULL DEFAULT true;

DROP INDEX "ShipmentRouteLine_productionRouteId_key";

CREATE UNIQUE INDEX "ShipmentRouteLine_productionRouteId_sequence_key"
ON "ShipmentRouteLine"("productionRouteId", "sequence");

ALTER TABLE "ShipmentRouteLine"
ALTER COLUMN "sequence" DROP DEFAULT,
ALTER COLUMN "isFinalBatch" SET DEFAULT false;

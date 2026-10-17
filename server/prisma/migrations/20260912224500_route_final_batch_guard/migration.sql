CREATE UNIQUE INDEX "ShipmentRouteLine_one_final_batch_per_route"
ON "ShipmentRouteLine"("productionRouteId")
WHERE "isFinalBatch" = true;

ALTER TABLE "ShipmentRouteLine"
ADD CONSTRAINT "ShipmentRouteLine_sequence_positive"
CHECK ("sequence" > 0);

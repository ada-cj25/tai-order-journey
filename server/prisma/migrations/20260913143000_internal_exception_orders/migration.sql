CREATE TYPE "OrderCreationMode" AS ENUM ('SALES_STANDARD', 'INTERNAL_EXCEPTION');
CREATE TYPE "OrderChargeMode" AS ENUM ('CHARGED', 'FREE');

ALTER TABLE "Order"
  ALTER COLUMN "amount" DROP NOT NULL,
  ALTER COLUMN "salesId" DROP NOT NULL,
  ADD COLUMN "creationMode" "OrderCreationMode" NOT NULL DEFAULT 'SALES_STANDARD',
  ADD COLUMN "chargeMode" "OrderChargeMode" NOT NULL DEFAULT 'CHARGED',
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "commercialConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "commercialConfirmedBy" TEXT,
  ADD COLUMN "exceptionReason" TEXT,
  ADD COLUMN "freeReason" TEXT;

UPDATE "Order" AS o
SET "createdById" = (
  SELECT e."actorId"
  FROM "OrderEvent" AS e
  WHERE e."orderId" = o.id AND e.type = 'ORDER_CREATED'
  ORDER BY e."createdAt" ASC
  LIMIT 1
)
WHERE o."createdById" IS NULL;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Order_commercialConfirmedBy_fkey" FOREIGN KEY ("commercialConfirmedBy") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Order_creationMode_chargeMode_commercialConfirmedAt_idx" ON "Order"("creationMode", "chargeMode", "commercialConfirmedAt");
CREATE INDEX "Order_createdById_createdAt_idx" ON "Order"("createdById", "createdAt");

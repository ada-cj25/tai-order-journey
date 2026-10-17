ALTER TABLE "Employee"
  ADD COLUMN "level" TEXT NOT NULL DEFAULT 'STAFF',
  ADD COLUMN "businessUnit" TEXT,
  ADD COLUMN "workshop" TEXT,
  ADD COLUMN "processCode" TEXT;

ALTER TABLE "Order"
  ADD COLUMN "productionDueAt" TIMESTAMP(3),
  ADD COLUMN "designAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "designLeadDays" INTEGER,
  ADD COLUMN "designDueAt" TIMESTAMP(3),
  ADD COLUMN "finishType" TEXT NOT NULL DEFAULT 'MELAMINE',
  ADD COLUMN "leatherDoor" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "villaFloors" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "depositReported" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "tailPaymentReported" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "procurementPlanned" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Task"
  ADD COLUMN "stage" "WorkflowStage",
  ADD COLUMN "workshop" TEXT;

ALTER TABLE "PurchaseDemand"
  ADD COLUMN "purchaseOrderNo" TEXT;

-- Persist supplement facts on the child order while keeping the parent immutable.
ALTER TABLE "Order"
  ADD COLUMN "supplementType" TEXT,
  ADD COLUMN "responsibilityType" TEXT,
  ADD COLUMN "supplementReason" TEXT;

-- Every workflow transition stores the evidence that justified it.
CREATE TABLE "StageSubmission" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "stage" "WorkflowStage" NOT NULL,
  "command" TEXT NOT NULL,
  "version" TEXT,
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
  "payload" JSONB NOT NULL,
  "checklist" JSONB,
  "comment" TEXT,
  "submittedBy" TEXT NOT NULL,
  "reviewedBy" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StageSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StageSubmission_orderId_stage_createdAt_idx"
  ON "StageSubmission"("orderId", "stage", "createdAt");

ALTER TABLE "StageSubmission"
  ADD CONSTRAINT "StageSubmission_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

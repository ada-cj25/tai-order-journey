ALTER TABLE "Order"
  ADD COLUMN "designerAssignedAt" TIMESTAMP(3),
  ADD COLUMN "designIntakeAvailableAt" TIMESTAMP(3),
  ADD COLUMN "designIntakeDueAt" TIMESTAMP(3),
  ADD COLUMN "designAssignmentVersion" INTEGER NOT NULL DEFAULT 0;

UPDATE "Order"
SET "designerAssignedAt" = "createdAt",
    "designAssignmentVersion" = 1
WHERE "designerId" IS NOT NULL;

UPDATE "Order" AS o
SET "designIntakeAvailableAt" = GREATEST(
      o."designerAssignedAt",
      COALESCE((
        SELECT MAX(s."createdAt")
        FROM "StageSubmission" AS s
        WHERE s."orderId" = o."id"
          AND s."command" IN ('CONFIRM_DEPOSIT', 'CONFIRM_INITIAL_PAYMENTS')
          AND s."status" <> 'DRAFT'
      ), o."updatedAt")
    ),
    "designIntakeDueAt" = GREATEST(
      o."designerAssignedAt",
      COALESCE((
        SELECT MAX(s."createdAt")
        FROM "StageSubmission" AS s
        WHERE s."orderId" = o."id"
          AND s."command" IN ('CONFIRM_DEPOSIT', 'CONFIRM_INITIAL_PAYMENTS')
          AND s."status" <> 'DRAFT'
      ), o."updatedAt")
    ) + INTERVAL '7 days'
WHERE o."stage" = 'DESIGN_PENDING'
  AND o."designerId" IS NOT NULL
  AND o."depositConfirmed" = true
  AND (o."prepaymentRequired" = false OR o."prepaymentConfirmed" = true);

UPDATE "Task" AS t
SET "status" = 'CANCELLED', "completedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
FROM "Order" AS o
WHERE t."orderId" = o."id"
  AND t."stage" = 'DESIGN_PENDING'
  AND t."status" IN ('PENDING', 'OVERDUE')
  AND o."designIntakeDueAt" IS NOT NULL;

INSERT INTO "Task" (
  "id", "orderId", "ownerId", "department", "title", "stage", "dueAt", "reminderAt",
  "status", "delayDays", "uniqueKey", "createdAt", "updatedAt"
)
SELECT
  'design-intake-migrated-' || o."id",
  o."id",
  o."designerId",
  '设计部',
  '设计下单',
  'DESIGN_PENDING',
  o."designIntakeDueAt",
  date_trunc('day', o."designIntakeDueAt" - CASE WHEN EXTRACT(DOW FROM o."designIntakeDueAt" - INTERVAL '1 day') = 0 THEN INTERVAL '2 days' ELSE INTERVAL '1 day' END) + INTERVAL '17 hours',
  CASE WHEN o."designIntakeDueAt" < CURRENT_TIMESTAMP THEN 'OVERDUE'::"TaskStatus" ELSE 'PENDING'::"TaskStatus" END,
  CASE WHEN o."designIntakeDueAt" < CURRENT_TIMESTAMP THEN GREATEST(1, CEIL(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - o."designIntakeDueAt")) / 86400.0)::INTEGER) ELSE 0 END,
  o."id" || ':DESIGN_PENDING:v' || o."designAssignmentVersion",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Order" AS o
WHERE o."stage" = 'DESIGN_PENDING'
  AND o."designerId" IS NOT NULL
  AND o."designIntakeDueAt" IS NOT NULL
ON CONFLICT ("uniqueKey") DO NOTHING;

CREATE INDEX "Order_stage_designIntakeDueAt_idx" ON "Order"("stage", "designIntakeDueAt");

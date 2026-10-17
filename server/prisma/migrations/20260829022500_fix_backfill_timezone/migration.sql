UPDATE "Task"
SET "plannedStartAt" = "plannedStartAt" - INTERVAL '8 hours',
    "dueAt" = "dueAt" - INTERVAL '8 hours',
    "reminderAt" = "reminderAt" - INTERVAL '8 hours'
WHERE "stage" = 'TECHNICAL'
  AND "workloadDays" IS NOT NULL
  AND "plannedStartAt" IS NOT NULL;

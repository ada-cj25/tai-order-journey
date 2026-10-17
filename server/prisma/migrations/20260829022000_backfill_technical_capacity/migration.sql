DO $$
DECLARE
  assignee RECORD;
  queued_task RECORD;
  previous_due DATE;
  slot_start DATE;
  slot_due DATE;
  slot_days INTEGER;
  remaining_days INTEGER;
BEGIN
  FOR assignee IN
    SELECT DISTINCT "ownerId"
    FROM "Task"
    WHERE "stage" = 'TECHNICAL'
      AND "ownerId" IS NOT NULL
      AND "status" IN ('PENDING', 'OVERDUE')
  LOOP
    previous_due := NULL;
    FOR queued_task IN
      SELECT task."id", task."createdAt", order_record."amount"
      FROM "Task" task
      JOIN "Order" order_record ON order_record."id" = task."orderId"
      WHERE task."ownerId" = assignee."ownerId"
        AND task."stage" = 'TECHNICAL'
        AND task."status" IN ('PENDING', 'OVERDUE')
      ORDER BY task."createdAt", task."id"
    LOOP
      slot_days := GREATEST(1, CEIL(queued_task."amount" / 60000.0)::INTEGER);
      slot_start := queued_task."createdAt"::DATE;
      IF EXTRACT(DOW FROM slot_start) = 0 THEN
        slot_start := slot_start + 1;
      END IF;
      IF previous_due IS NOT NULL AND previous_due >= slot_start THEN
        slot_start := previous_due + 1;
        IF EXTRACT(DOW FROM slot_start) = 0 THEN
          slot_start := slot_start + 1;
        END IF;
      END IF;

      slot_due := slot_start;
      remaining_days := slot_days - 1;
      WHILE remaining_days > 0 LOOP
        slot_due := slot_due + 1;
        IF EXTRACT(DOW FROM slot_due) <> 0 THEN
          remaining_days := remaining_days - 1;
        END IF;
      END LOOP;

      UPDATE "Task"
      SET "plannedStartAt" = slot_start::TIMESTAMP,
          "dueAt" = slot_due::TIMESTAMP + TIME '17:00:00',
          "workloadDays" = slot_days,
          "reminderAt" = CASE
            WHEN EXTRACT(DOW FROM slot_due - 1) = 0
              THEN (slot_due - 2)::TIMESTAMP + TIME '17:00:00'
            ELSE (slot_due - 1)::TIMESTAMP + TIME '17:00:00'
          END
      WHERE "id" = queued_task."id";
      previous_due := slot_due;
    END LOOP;
  END LOOP;
END $$;

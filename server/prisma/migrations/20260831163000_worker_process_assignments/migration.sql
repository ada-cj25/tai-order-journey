ALTER TABLE "Employee" ADD COLUMN "processCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Preserve existing exact assignments without changing accounts or report history.
UPDATE "Employee"
SET "processCodes" = ARRAY["processCode"]
WHERE "role" = 'WORKSHOP' AND "level" = 'STAFF'
  AND (("workshop" = 'PANEL' AND "processCode" ~ '^PANEL-0[1-6]$')
    OR ("workshop" = 'WOOD' AND "processCode" ~ '^WOOD-0[1-5]$')
    OR ("workshop" = 'PAINT' AND "processCode" ~ '^PAINT-0[1-8]$')
    OR ("workshop" = 'ASSEMBLY' AND "processCode" ~ '^ASSEMBLY-0[1-4]$'));

UPDATE "ProductionProcess" SET "processName" = '送组装车间' WHERE "workshop" = 'PANEL' AND "processCode" = 'PANEL-06';
UPDATE "ProductionProcess" SET "processName" = '送油漆车间' WHERE "workshop" = 'WOOD' AND "processCode" = 'WOOD-05';

UPDATE "ProductionProcess" SET "processName" = '喷底漆' WHERE "workshop" = 'PAINT' AND "processCode" IN ('PAINT-02', 'PAINT-04');
UPDATE "ProductionProcess" SET "processName" = '一次油磨' WHERE "workshop" = 'PAINT' AND "processCode" = 'PAINT-03';
UPDATE "ProductionProcess" SET "processName" = '二次油磨' WHERE "workshop" = 'PAINT' AND "processCode" = 'PAINT-05';
UPDATE "ProductionProcess" SET "processName" = '喷面漆' WHERE "workshop" = 'PAINT' AND "processCode" = 'PAINT-06';
UPDATE "ProductionProcess" SET "processName" = '送组装车间' WHERE "workshop" = 'PAINT' AND "processCode" = 'PAINT-08';

DELETE FROM "ProductionProcess" WHERE "workshop" = 'ASSEMBLY' AND "processCode" = 'ASSEMBLY-01';
UPDATE "ProductionProcess" SET "processCode" = 'ASSEMBLY-TMP-02' WHERE "workshop" = 'ASSEMBLY' AND "processCode" = 'ASSEMBLY-02';
UPDATE "ProductionProcess" SET "processCode" = 'ASSEMBLY-TMP-03' WHERE "workshop" = 'ASSEMBLY' AND "processCode" = 'ASSEMBLY-03';
UPDATE "ProductionProcess" SET "processCode" = 'ASSEMBLY-TMP-04' WHERE "workshop" = 'ASSEMBLY' AND "processCode" = 'ASSEMBLY-04';
UPDATE "ProductionProcess" SET "processCode" = 'ASSEMBLY-TMP-05' WHERE "workshop" = 'ASSEMBLY' AND "processCode" = 'ASSEMBLY-05';
UPDATE "ProductionProcess" SET "processCode" = 'ASSEMBLY-01', "processName" = '打包', "sequence" = 1 WHERE "workshop" = 'ASSEMBLY' AND "processCode" = 'ASSEMBLY-TMP-02';
UPDATE "ProductionProcess" SET "processCode" = 'ASSEMBLY-02', "processName" = '领五金', "sequence" = 2 WHERE "workshop" = 'ASSEMBLY' AND "processCode" = 'ASSEMBLY-TMP-03';
UPDATE "ProductionProcess" SET "processCode" = 'ASSEMBLY-03', "processName" = '入库', "sequence" = 3 WHERE "workshop" = 'ASSEMBLY' AND "processCode" = 'ASSEMBLY-TMP-04';
UPDATE "ProductionProcess" SET "processCode" = 'ASSEMBLY-04', "processName" = '订单生产完成', "sequence" = 4 WHERE "workshop" = 'ASSEMBLY' AND "processCode" = 'ASSEMBLY-TMP-05';

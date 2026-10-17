import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaService } from "../server/prisma.service.js";
import { OrderNumberAllocator } from "../server/number-allocator.service.js";
import { localTestAccountsEnabled } from "../server/runtime-config.js";

if (!localTestAccountsEnabled()) throw new Error("编号回归只允许本地非生产数据库");
const db = new PrismaService();
const allocator = new OrderNumberAllocator();
const rollback = new Error("LOCAL_NUMBER_TEST_ROLLBACK");
try {
  // Reserved only within this transaction, rolled back even on success.
  await db.$transaction(async (tx) => {
    assert.equal(await tx.productionNumberSequence.count({ where: { yearMonth: { in: ["209801", "209802"] } } }), 0, "验收月份已有编号池，停止测试");
    const date = new Date("2098-01-15T09:00:00+08:00");
    assert.equal(await allocator.allocate(tx, "NOERLI_FORMAL", date), "98011001");
    assert.equal(await allocator.allocate(tx, "NOERLI_FORMAL", date), "98011002");
    assert.equal(await allocator.allocate(tx, "AIKEJU_FORMAL", date), "98019001");
    assert.equal(await allocator.allocate(tx, "NOERLI_SUPPLEMENT", date), "补单-B98010001");
    assert.equal(await allocator.allocate(tx, "CHANNEL_FORMAL", date), "98015001");
    assert.equal(await allocator.allocate(tx, "CHANNEL_SUPPLEMENT", date), "补单-B98015002");
    assert.equal(await allocator.allocate(tx, "NOERLI_FORMAL", new Date("2098-02-15T09:00:00+08:00")), "98021001");
    await tx.productionNumberSequence.update({ where: { yearMonth_category: { yearMonth: "209801", category: 1 } }, data: { lastValue: 998 } });
    assert.equal(await allocator.allocate(tx, "NOERLI_FORMAL", date), "98011999");
    await assert.rejects(allocator.allocate(tx, "NOERLI_FORMAL", date), /999/);
    throw rollback;
  }).catch((error) => { if (error !== rollback) throw error; });
  assert.equal(await db.productionNumberSequence.count({ where: { yearMonth: { in: ["209801", "209802"] } } }), 0);
  console.log("PASS: 空池001→002、品牌独立、补单独立、渠道共享、换月001、999上限；全部事务回滚，现有编号池和订单未修改。");
} finally { await db.$disconnect(); }

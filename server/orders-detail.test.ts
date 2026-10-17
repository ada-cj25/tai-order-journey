import assert from "node:assert/strict";
import test from "node:test";
import { OrdersService } from "./orders.service.js";

test("订单详情查询完整阶段记录，不按最近 20 条截断", async () => {
  let findFirstArgs: Record<string, any> | undefined;
  const prisma = {
    order: {
      findFirst: (args: Record<string, any>) => {
        findFirstArgs = args;
        return Promise.resolve(null);
      },
    },
  };
  const service = new OrdersService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);

  await assert.rejects(() => service.detail("order-id", { id: "chairman", role: "CHAIRMAN" } as never), /订单不存在/);

  assert.deepEqual(findFirstArgs?.include?.stageSubmissions, { orderBy: { createdAt: "desc" } });
});

test("付款汇总单独查询完整的定金和预付款报备", async () => {
  let reportQuery: Record<string, any> | undefined;
  const stopAfterQuery = new Error("payment reports queried");
  const prisma = {
    order: { findFirst: () => Promise.resolve({ productionProcesses: [] }) },
    stageSubmission: {
      findMany: (args: Record<string, any>) => {
        reportQuery = args;
        throw stopAfterQuery;
      },
    },
  };
  const service = new OrdersService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);

  await assert.rejects(() => service.detail("order-id", { id: "chairman", role: "CHAIRMAN" } as never), (error) => error === stopAfterQuery);

  assert.deepEqual(reportQuery?.where, {
    orderId: "order-id",
    command: { in: ["REPORT_DEPOSIT", "REPORT_PREPAYMENT"] },
    status: { not: "DRAFT" },
  });
  assert.equal(reportQuery?.take, undefined);
});

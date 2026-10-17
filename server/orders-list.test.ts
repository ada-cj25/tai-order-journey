import assert from "node:assert/strict";
import test from "node:test";
import { OrdersService } from "./orders.service.js";

test("订单列表返回销售和设计师 ID，供关联补单继承", async () => {
  let findManyArgs: Record<string, any> | undefined;
  const prisma = {
    order: {
      findMany: (args: Record<string, any>) => {
        findManyArgs = args;
        return Promise.resolve([]);
      },
      count: () => Promise.resolve(0),
    },
    $transaction: (operations: Array<Promise<unknown>>) => Promise.all(operations),
  };
  const service = new OrdersService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);

  await service.list({ id: "chairman", role: "CHAIRMAN" } as never, {});

  assert.equal(findManyArgs?.include?.sales?.select?.id, true);
  assert.equal(findManyArgs?.include?.designer?.select?.id, true);
});

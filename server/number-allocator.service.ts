import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma } from "./generated/prisma/client.js";
import { categoryDigit, productionNumber, salesNumber, salesPrefix, yearMonth } from "./domain/rules.js";
import type { BusinessType } from "./domain/types.js";

@Injectable()
export class OrderNumberAllocator {
  async allocateSales(tx: Prisma.TransactionClient, businessType: BusinessType, submittedAt: Date, trackingSerial: string) {
    if (trackingSerial.startsWith("TEST-")) return `TEST-SALES-${trackingSerial}`;
    const month = yearMonth(submittedAt);
    const prefix = salesPrefix(businessType);
    const rows = await tx.$queryRaw<Array<{ lastValue: number }>>`
      INSERT INTO "SalesNumberSequence" ("id", "yearMonth", "prefix", "lastValue", "updatedAt")
      VALUES (${randomUUID()}, ${month}, ${prefix}, 1, NOW())
      ON CONFLICT ("yearMonth", "prefix")
      DO UPDATE SET "lastValue" = "SalesNumberSequence"."lastValue" + 1, "updatedAt" = NOW()
      RETURNING "lastValue"
    `;
    const sequence = rows[0]?.lastValue ?? 0;
    if (sequence > 9999) throw new Error("当月该品牌销售编号已达9999，已停止生成，请联系董事长管理员");
    return salesNumber(businessType, submittedAt, sequence);
  }

  async allocate(tx: Prisma.TransactionClient, businessType: BusinessType, submittedAt: Date) {
    const month = yearMonth(submittedAt);
    const category = categoryDigit(businessType);
    const rows = await tx.$queryRaw<Array<{ lastValue: number }>>`
      INSERT INTO "ProductionNumberSequence" ("id", "yearMonth", "category", "lastValue", "updatedAt")
      VALUES (${randomUUID()}, ${month}, ${category}, 1, NOW())
      ON CONFLICT ("yearMonth", "category")
      DO UPDATE SET "lastValue" = "ProductionNumberSequence"."lastValue" + 1, "updatedAt" = NOW()
      RETURNING "lastValue"
    `;
    const sequence = rows[0]?.lastValue ?? 0;
    if (sequence > 999) throw new Error("当月该分类生产编号已达999，已停止生成，请联系董事长管理员");
    return productionNumber(businessType, submittedAt, sequence);
  }
}

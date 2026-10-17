import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Request } from "express";
import type { Prisma } from "./generated/prisma/client.js";
import type { PrismaService } from "./prisma.service.js";

export type MutationMeta = { key?: string; expectedUpdatedAt?: string };

export function mutationMeta(request: Request): MutationMeta {
  return { key: request.header("idempotency-key"), expectedUpdatedAt: request.header("x-expected-updated-at") };
}

export function mutationFingerprint(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical) : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, canonical(val)])) : item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function assertCurrentVersion(updatedAt: Date, meta: MutationMeta) {
  if (process.env.NODE_ENV === "production" && !meta.expectedUpdatedAt) throw new BadRequestException("请刷新页面后提交，缺少当前订单版本");
  if (meta.expectedUpdatedAt && meta.expectedUpdatedAt !== updatedAt.toISOString()) throw new ConflictException("订单已被更新，请刷新后核对最新状态再提交");
}

export async function runMutation<T>(prisma: PrismaService, actorId: string, scope: string, input: unknown, meta: MutationMeta, execute: (tx: Prisma.TransactionClient) => Promise<T>, orderId?: string): Promise<T> {
  if (meta.key && !/^[A-Za-z0-9_-]{16,128}$/.test(meta.key)) throw new BadRequestException("提交标识格式无效");
  if (process.env.NODE_ENV === "production" && !meta.key) throw new BadRequestException("缺少防重复提交标识，请刷新后重试");
  const fingerprint = mutationFingerprint({ input, expectedUpdatedAt: meta.expectedUpdatedAt });
  return prisma.$transaction(async (tx) => {
    if (meta.key) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${actorId}:${scope}:${meta.key}`}))`;
      const previous = await tx.mutationReceipt.findUnique({ where: { actorId_scope_key: { actorId, scope, key: meta.key } } });
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ConflictException("同一提交标识不能用于不同内容");
        return previous.result as T;
      }
    }
    if (orderId) await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
    const result = await execute(tx);
    if (meta.key) await tx.mutationReceipt.create({ data: { actorId, scope, key: meta.key, fingerprint, result: JSON.parse(JSON.stringify(result ?? { ok: true })) as Prisma.InputJsonValue } });
    return result;
  }, { maxWait: 10_000, timeout: 30_000 });
}

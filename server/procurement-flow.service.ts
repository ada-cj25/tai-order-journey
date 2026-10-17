import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomInt } from "node:crypto";
import { addInternalWorkingDays, previousInternalWorkday } from "./domain/rules.js";
import type { Employee, Prisma } from "./generated/prisma/client.js";
import { PrismaService } from "./prisma.service.js";

@Injectable()
export class ProcurementFlow {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(employee: Employee) {
    if (employee.role !== "CHAIRMAN") throw new ForbiddenException("旧版采购记录仅董事长管理员可审计读取");
    const canSeePrices = ["PROCUREMENT", "FINANCE", "CHAIRMAN"].includes(employee.role);
    const [releases, requirements, quotes, purchaseOrders, receipts, returns, standards, suppliers, policyChanges] = await Promise.all([
      this.prisma.materialListVersion.findMany({
        where: { status: { in: ["PUBLISHED", "WAREHOUSE_RELEASED"] } },
        include: { order: { select: { id: true, trackingSerial: true, productionNumber: true, customerName: true, stage: true, productionReady: true } }, lines: { include: { item: true }, orderBy: { sourceRow: "asc" } } },
        orderBy: { releasedAt: "desc" },
      }),
      this.prisma.purchaseRequirement.findMany({
        include: { item: true, order: { select: { id: true, trackingSerial: true, productionNumber: true, customerName: true } }, quotes: { include: { supplier: true }, orderBy: { createdAt: "desc" } } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.supplierQuote.findMany({ include: { supplier: true, requirement: { include: { item: true, order: { select: { id: true, trackingSerial: true, productionNumber: true } } } } }, orderBy: { createdAt: "desc" } }),
      this.prisma.purchaseOrder.findMany({ include: { supplier: true, lines: { include: { item: true, allocations: { include: { order: { select: { id: true, trackingSerial: true, productionNumber: true } } } } } } }, orderBy: { createdAt: "desc" } }),
      this.prisma.goodsReceipt.findMany({ include: { purchaseOrder: { include: { supplier: true } }, lines: { include: { item: true } } }, orderBy: { receivedAt: "desc" } }),
      this.prisma.purchaseReturn.findMany({ include: { purchaseOrderLine: { include: { purchaseOrder: true, item: true } }, receiptLine: true }, orderBy: { createdAt: "desc" } }),
      this.prisma.inventoryItem.findMany({ where: { mode: "STOCK_STANDARD", approvedStandard: true, active: true }, orderBy: { sku: "asc" } }),
      this.prisma.supplier.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
      this.prisma.stockPolicyVersion.findMany({ include: { item: true }, orderBy: { proposedAt: "desc" } }),
    ]);
    const suggestions = standards
      .filter((item) => Number(item.onHand) - Number(item.reserved) < Number(item.minimumStock ?? 0))
      .map((item) => ({
        itemId: item.id,
        sku: item.sku,
        name: item.name,
        available: Number(item.onHand) - Number(item.reserved),
        suggestedQty: Math.max(Number(item.replenishmentLot ?? 0), Number(item.targetStock ?? 0) - Number(item.onHand) + Number(item.reserved)),
        status: "SUGGESTION_ONLY",
      }));
    if (!canSeePrices) {
      return {
        releases,
        requirements: requirements.map(({ quotes: _quotes, ...requirement }) => requirement),
        quotes: quotes.map(({ unitPrice: _unitPrice, freight: _freight, ...quote }) => quote),
        purchaseOrders: purchaseOrders.map(({ totalAmount: _totalAmount, ...purchaseOrder }) => ({ ...purchaseOrder, lines: purchaseOrder.lines.map(({ unitPrice: _unitPrice, ...line }) => line) })),
        receipts,
        returns,
        suggestions,
        standards,
        suppliers,
        policyChanges,
      };
    }
    return { releases, requirements, quotes, purchaseOrders, receipts, returns, suggestions, standards, suppliers, policyChanges };
  }

  async warehouseRelease(materialVersionId: string, employee: Employee, input: { location?: string; batchNo?: string; note?: string }) {
    requireRole(employee, ["WAREHOUSE", "CHAIRMAN"], "只有仓库可以执行库存核料与预留");
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.materialListVersion.findUnique({ where: { id: materialVersionId }, include: { order: true, lines: { include: { item: true } } } });
      if (!version || version.status !== "PUBLISHED") throw new BadRequestException("物料版不存在或已经完成仓库核料");
      let productionReady = true;
      let purchaseRequired = false;
      for (const line of version.lines) {
        if (!line.item) throw new BadRequestException(`物料“${line.normalizedName}”尚未匹配物料档案`);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inventory:${line.item.id}`}))`;
        const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: line.item.id } });
        const requestedQty = Number(line.purchaseQty);
        const available = Math.max(0, Number(item.onHand) - Number(item.reserved));
        const stockQty = Math.min(available, requestedQty);
        const purchaseQty = round4(requestedQty - stockQty);
        if (stockQty > 0) {
          await tx.inventoryItem.update({ where: { id: item.id }, data: { reserved: { increment: stockQty } } });
          await tx.stockReservation.create({ data: { orderId: version.orderId, materialLineId: line.id, itemId: item.id, quantity: stockQty, location: input.location, batchNo: input.batchNo, reservedBy: employee.id } });
          await tx.stockMovement.create({ data: { itemId: item.id, orderId: version.orderId, materialLineId: line.id, quantity: stockQty, direction: "RESERVE", location: input.location, batchNo: input.batchNo, referenceType: "MATERIAL_VERSION", referenceId: version.id, note: input.note } });
        }
        const status = purchaseQty > 0 ? item.mode === "STOCK_STANDARD" ? "REPLENISHMENT_SUGGESTED" : "PURCHASE_REQUIRED" : "STOCK_RESERVED";
        await tx.purchaseRequirement.create({
          data: {
            orderId: version.orderId,
            materialVersionId: version.id,
            materialLineId: line.id,
            itemId: item.id,
            mode: item.mode,
            requestedQty,
            stockQty,
            purchaseQty,
            status,
            source: item.mode === "STOCK_STANDARD" ? "STANDARD_STOCK" : "ORDER_SPECIFIC",
            requiredAt: version.order.productionDueAt ?? version.order.internalDueAt,
            riskLevel: line.readinessClass === "PRODUCTION_REQUIRED" && purchaseQty > 0 ? "BLOCKING" : purchaseQty > 0 ? "READINESS" : "NORMAL",
            allocation: { orderId: version.orderId, materialVersionId: version.id, materialLineId: line.id },
          },
        });
        await tx.materialLine.update({ where: { id: line.id }, data: { stockQty, status: purchaseQty > 0 ? "PURCHASE_REQUIRED" : "STOCK_RESERVED" } });
        if (purchaseQty > 0) purchaseRequired = true;
        if (line.readinessClass === "PRODUCTION_REQUIRED" && purchaseQty > 0) productionReady = false;
      }
      await tx.materialListVersion.update({ where: { id: version.id }, data: { status: "WAREHOUSE_RELEASED", warehouseCheckedBy: employee.id, warehouseCheckedAt: new Date(), productionReleasedAt: productionReady ? new Date() : null } });
      await tx.order.update({ where: { id: version.orderId }, data: { procurementPlanned: true, productionReady, materialSubstatus: productionReady ? purchaseRequired ? "生产料齐备·交付料待采购" : "全部物料齐备" : "生产料待采购", currentOwnerLabel: purchaseRequired ? "采购部" : "订单管理员", nextAction: productionReady ? "生产必需料齐备，可下达四车间" : "采购生产必需物料" } });
      await tx.task.updateMany({ where: { orderId: version.orderId, uniqueKey: `${version.orderId}:MATERIALS`, status: { in: ["PENDING", "OVERDUE"] } }, data: { status: "COMPLETE", completedAt: new Date() } });
      if (purchaseRequired) await this.upsertProcurementTask(tx, version.orderId, "采购询价", 3, "PROCUREMENT");
      await tx.orderEvent.create({ data: { orderId: version.orderId, actorId: employee.id, type: "WAREHOUSE_RELEASE", title: "仓库核料与预留完成", description: productionReady ? "生产必需料已齐备，交付物料缺口继续采购" : "已生成生产必需料采购缺口", fromStage: "MATERIALS", toStage: "MATERIALS", metadata: { materialVersionId: version.id, productionReady } } });
      return this.orderMaterialProjection(tx, version.orderId);
    });
  }

  async createSupplier(employee: Employee, input: { code: string; name: string; contact?: string; phone?: string; taxNo?: string }) {
    requireRole(employee, ["PROCUREMENT", "CHAIRMAN"], "只有采购可以维护供应商");
    if (!input.code?.trim() || !input.name?.trim()) throw new BadRequestException("供应商编码和名称必填");
    return this.prisma.supplier.create({ data: { code: input.code.trim(), name: input.name.trim(), contact: input.contact, phone: input.phone, taxNo: input.taxNo } });
  }

  async submitQuote(requirementId: string, employee: Employee, input: { supplierId: string; unitPrice: number; taxRate?: number; freight?: number; minimumOrderQty?: number; deliveryAt: string; validUntil?: string; attachmentIds?: string[]; note?: string }) {
    requireRole(employee, ["PROCUREMENT", "CHAIRMAN"], "只有采购可以提交询报价");
    if (!(Number(input.unitPrice) >= 0) || !input.deliveryAt) throw new BadRequestException("含税单价和供应商交期必填");
    if (!input.attachmentIds?.length) throw new BadRequestException("必须上传供应商报价附件");
    return this.prisma.$transaction(async (tx) => {
      const requirement = await tx.purchaseRequirement.findUnique({ where: { id: requirementId }, include: { order: true, item: true } });
      if (!requirement || !["PURCHASE_REQUIRED", "QUOTING"].includes(requirement.status)) throw new BadRequestException("采购需求当前不能提交报价；常备品须先由采购确认补货");
      const deliveryAt = new Date(input.deliveryAt);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (Number.isNaN(deliveryAt.getTime()) || deliveryAt < today) throw new BadRequestException("供应商承诺交付日不能早于今天");
      if (requirement.requiredAt && deliveryAt > requirement.requiredAt) throw new BadRequestException("供应商承诺交付日不能晚于该采购需求的要求到货日期");
      await tx.supplier.findUniqueOrThrow({ where: { id: input.supplierId } });
      const quote = await tx.supplierQuote.create({
        data: {
          requirementId,
          supplierId: input.supplierId,
          status: "DRAFT",
          unitPrice: input.unitPrice,
          taxRate: Number(input.taxRate ?? 0),
          freight: Number(input.freight ?? 0),
          minimumOrderQty: input.minimumOrderQty == null ? null : Number(input.minimumOrderQty),
          deliveryAt,
          validUntil: input.validUntil ? new Date(input.validUntil) : null,
          attachmentIds: input.attachmentIds ?? [],
          note: input.note,
          submittedBy: employee.id,
        },
      });
      await tx.purchaseRequirement.update({ where: { id: requirementId }, data: { status: "QUOTING" } });
      if (requirement.orderId) await tx.orderEvent.create({ data: { orderId: requirement.orderId, actorId: employee.id, type: "SAVE_SUPPLIER_QUOTE", title: "采购候选报价已保存", description: `${requirement.item.name} · ${requirement.item.unit}`, fromStage: "MATERIALS", toStage: "MATERIALS", metadata: { quoteId: quote.id, requirementId } } });
      return quote;
    });
  }

  async submitQuoteForReview(quoteId: string, employee: Employee) {
    requireRole(employee, ["PROCUREMENT", "CHAIRMAN"], "只有采购可以选择拟中标报价并提交审价");
    return this.prisma.$transaction(async (tx) => {
      const quote = await tx.supplierQuote.findUnique({ where: { id: quoteId }, include: { requirement: { include: { order: true, item: true } }, supplier: true } });
      if (!quote || quote.status !== "DRAFT" || !["QUOTING", "PURCHASE_REQUIRED"].includes(quote.requirement.status)) throw new BadRequestException("该候选报价当前不能提交审价");
      const reviewing = await tx.supplierQuote.findFirst({ where: { requirementId: quote.requirementId, status: "PRICE_REVIEW" } });
      if (reviewing) throw new BadRequestException("该采购需求已有一条报价正在财务审价");
      await tx.supplierQuote.update({ where: { id: quoteId }, data: { status: "PRICE_REVIEW", submittedAt: new Date() } });
      await tx.purchaseRequirement.update({ where: { id: quote.requirementId }, data: { status: "PRICE_REVIEW" } });
      if (quote.requirement.orderId) await this.upsertTask(tx, quote.requirement.orderId, `报价审价 · ${quote.requirement.item.name}`, 1, "FINANCE", `PRICE_REVIEW:${quote.id}`);
      await this.notifyRole(tx, "FINANCE", `PRICE_REVIEW:${quote.id}`, "采购报价待审价", `${quote.requirement.item.name}已选择${quote.supplier.name}为拟中标报价，请核对价格、税费和交期。`);
      if (quote.requirement.orderId) await tx.orderEvent.create({ data: { orderId: quote.requirement.orderId, actorId: employee.id, type: "SUBMIT_SUPPLIER_QUOTE", title: "拟中标报价已提交财务审价", description: `${quote.requirement.item.name} · ${quote.supplier.name}`, fromStage: "MATERIALS", toStage: "MATERIALS", metadata: { quoteId, requirementId: quote.requirementId } } });
      return { ok: true };
    });
  }

  async reviewQuote(quoteId: string, employee: Employee, input: { approved: boolean; comment?: string }) {
    requireRole(employee, ["FINANCE", "CHAIRMAN"], "只有财务成本岗可以审核采购价格");
    return this.prisma.$transaction(async (tx) => {
      const quote = await tx.supplierQuote.findUnique({ where: { id: quoteId }, include: { requirement: { include: { order: true, item: true } } } });
      if (!quote || quote.status !== "PRICE_REVIEW") throw new BadRequestException("报价不存在或已完成审核");
      const status = input.approved ? "APPROVED" : "REJECTED";
      await tx.supplierQuote.update({ where: { id: quoteId }, data: { status, reviewedBy: employee.id, reviewComment: input.comment, reviewedAt: new Date() } });
      if (input.approved) await tx.supplierQuote.updateMany({ where: { requirementId: quote.requirementId, id: { not: quoteId }, status: "DRAFT" }, data: { status: "CANCELLED" } });
      await tx.purchaseRequirement.update({ where: { id: quote.requirementId }, data: { status: input.approved ? "APPROVED" : "QUOTING" } });
      await tx.task.updateMany({ where: { uniqueKey: `PRICE_REVIEW:${quote.id}`, status: { in: ["PENDING", "OVERDUE"] } }, data: { status: "COMPLETE", completedAt: new Date() } });
      if (input.approved && quote.requirement.orderId) await this.upsertTask(tx, quote.requirement.orderId, `生成采购单 · ${quote.requirement.item.name}`, 1, "PROCUREMENT", `CREATE_PO:${quote.id}`);
      if (quote.requirement.orderId) await tx.orderEvent.create({ data: { orderId: quote.requirement.orderId, actorId: employee.id, type: input.approved ? "APPROVE_SUPPLIER_QUOTE" : "REJECT_SUPPLIER_QUOTE", title: input.approved ? "财务审价通过" : "财务退回采购报价", description: input.comment || quote.requirement.item.name, fromStage: "MATERIALS", toStage: "MATERIALS", metadata: { quoteId } } });
      return { ok: true, status };
    });
  }

  async createPurchaseOrder(employee: Employee, input: { quoteIds: string[]; expectedAt?: string; note?: string }) {
    requireRole(employee, ["PROCUREMENT", "CHAIRMAN"], "只有采购可以生成采购单");
    if (!input.quoteIds?.length) throw new BadRequestException("至少选择一条已审价报价");
    return this.prisma.$transaction(async (tx) => {
      const quotes = await tx.supplierQuote.findMany({ where: { id: { in: input.quoteIds } }, include: { requirement: { include: { item: true } } } });
      if (quotes.length !== input.quoteIds.length || quotes.some((quote) => quote.status !== "APPROVED")) throw new BadRequestException("所有报价必须先通过财务审价");
      const supplierIds = new Set(quotes.map((quote) => quote.supplierId));
      if (supplierIds.size !== 1) throw new BadRequestException("一张采购单只能对应一个供应商");
      const existing = await tx.purchaseOrderLine.findFirst({ where: { quoteId: { in: input.quoteIds } } });
      if (existing) throw new BadRequestException("所选报价已经生成采购单");
      const orderNo = poNumber();
      const totalAmount = round2(quotes.reduce((sum, quote) => sum + Number(quote.requirement.purchaseQty) * Number(quote.unitPrice) + Number(quote.freight), 0));
      const purchaseOrder = await tx.purchaseOrder.create({ data: { orderNo, supplierId: quotes[0]!.supplierId, status: "APPROVED", totalAmount, expectedAt: input.expectedAt ? new Date(input.expectedAt) : latestDate(quotes.map((quote) => quote.deliveryAt)), approvedAt: new Date(), note: input.note, createdBy: employee.id } });
      const affectedOrders = new Set<string>();
      for (const quote of quotes) {
        const line = await tx.purchaseOrderLine.create({ data: { purchaseOrderId: purchaseOrder.id, quoteId: quote.id, itemId: quote.requirement.itemId, specification: quote.requirement.item.specification, unit: quote.requirement.item.unit, quantity: quote.requirement.purchaseQty, unitPrice: quote.unitPrice, taxRate: quote.taxRate } });
        await tx.purchaseAllocation.create({ data: { purchaseOrderLineId: line.id, requirementId: quote.requirementId, orderId: quote.requirement.orderId, materialVersionId: quote.requirement.materialVersionId, quantity: quote.requirement.purchaseQty } });
        await tx.purchaseRequirement.update({ where: { id: quote.requirementId }, data: { status: "ORDERED", orderedQty: quote.requirement.purchaseQty } });
        await tx.task.updateMany({ where: { uniqueKey: `CREATE_PO:${quote.id}`, status: { in: ["PENDING", "OVERDUE"] } }, data: { status: "COMPLETE", completedAt: new Date() } });
        if (quote.requirement.orderId) affectedOrders.add(quote.requirement.orderId);
      }
      for (const orderId of affectedOrders) {
        await tx.order.update({ where: { id: orderId }, data: { materialSubstatus: "采购单待正式下达", currentOwnerLabel: "采购部", nextAction: "正式下达采购单" } });
        await tx.orderEvent.create({ data: { orderId, actorId: employee.id, type: "CREATE_PURCHASE_ORDER", title: "采购单已生成", description: `${orderNo} · 已通过财务审价`, fromStage: "MATERIALS", toStage: "MATERIALS", metadata: { purchaseOrderId: purchaseOrder.id, orderNo } } });
      }
      return tx.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrder.id }, include: { supplier: true, lines: { include: { item: true, allocations: true } } } });
    });
  }

  async issuePurchaseOrder(id: string, employee: Employee) {
    requireRole(employee, ["PROCUREMENT", "CHAIRMAN"], "只有采购可以正式下达采购单");
    return this.prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.findUnique({ where: { id }, include: { lines: { include: { allocations: true } } } });
      if (!purchaseOrder || purchaseOrder.status !== "APPROVED") throw new BadRequestException("采购单不存在或已经下达");
      await tx.purchaseOrder.update({ where: { id }, data: { status: "ISSUED", issuedAt: new Date(), issuedBy: employee.id } });
      const orderIds = new Set(purchaseOrder.lines.flatMap((line) => line.allocations.map((allocation) => allocation.orderId)).filter((orderId): orderId is string => Boolean(orderId)));
      for (const orderId of orderIds) {
        await tx.order.update({ where: { id: orderId }, data: { materialSubstatus: "采购中", currentOwnerLabel: "采购部", nextAction: "跟进供应商按期到货" } });
        await tx.orderEvent.create({ data: { orderId, actorId: employee.id, type: "ISSUE_PURCHASE_ORDER", title: "采购单已正式下达", description: purchaseOrder.orderNo, fromStage: "MATERIALS", toStage: "MATERIALS", metadata: { purchaseOrderId: id } } });
      }
      return { ok: true };
    });
  }

  async terminatePurchaseOrder(id: string, employee: Employee, input: { reason: string; supplierConfirmation?: string }) {
    requireRole(employee, ["PROCUREMENT", "CHAIRMAN"], "只有采购或董事长管理员可以终止采购单");
    if (!input.reason?.trim()) throw new BadRequestException("终止原因必填");
    return this.prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.findUnique({ where: { id }, include: { lines: { include: { allocations: { include: { requirement: true } } } } } });
      if (!purchaseOrder || !["APPROVED", "ISSUED", "PARTIAL_RECEIVED", "RETURN_IN_PROGRESS"].includes(purchaseOrder.status)) throw new BadRequestException("采购单当前不能终止");
      if (purchaseOrder.issuedAt && !input.supplierConfirmation?.trim()) throw new BadRequestException("已下达采购单必须登记供应商确认结果");
      const affectedOrders = new Set<string>();
      for (const line of purchaseOrder.lines) {
        const remaining = round4(Number(line.quantity) - Number(line.receivedQty) - Number(line.cancelledQty));
        if (remaining > 0) await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { cancelledQty: { increment: remaining } } });
        for (const allocation of line.allocations) {
          if (allocation.orderId) affectedOrders.add(allocation.orderId);
          if (!["RECEIVED", "CANCELLED"].includes(allocation.requirement.status)) await tx.purchaseRequirement.update({ where: { id: allocation.requirementId }, data: { status: "CANCELLED" } });
        }
      }
      const note = [purchaseOrder.note, `终止原因：${input.reason.trim()}`, input.supplierConfirmation ? `供应商确认：${input.supplierConfirmation.trim()}` : null].filter(Boolean).join("\n");
      await tx.purchaseOrder.update({ where: { id }, data: { status: "TERMINATED", note } });
      for (const orderId of affectedOrders) {
        await tx.orderEvent.create({ data: { orderId, actorId: employee.id, type: "TERMINATE_PURCHASE_ORDER", title: "采购单已终止", description: input.reason.trim(), fromStage: "MATERIALS", toStage: "MATERIALS", metadata: { purchaseOrderId: id, supplierConfirmation: input.supplierConfirmation ?? null } } });
        await this.refreshOrderReadiness(tx, orderId, employee.id);
      }
      return { ok: true };
    });
  }

  async receive(employee: Employee, input: { purchaseOrderId: string; supplierDeliveryNo?: string; receivedAt: string; deliveryAttachmentIds?: string[]; note?: string; lines: Array<{ purchaseOrderLineId: string; deliveredQty: number; acceptedQty: number; rejectedQty?: number; shortageQty?: number; photoAttachmentIds?: string[]; qualityAttachmentIds?: string[]; note?: string }> }) {
    requireRole(employee, ["WAREHOUSE", "CHAIRMAN"], "只有仓库可以验收入库");
    if (!input.lines?.length) throw new BadRequestException("至少填写一条到货明细");
    if (!input.deliveryAttachmentIds?.length) throw new BadRequestException("必须上传送货单、实物照片或质量凭证");
    return this.prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.findUnique({ where: { id: input.purchaseOrderId }, include: { lines: { include: { allocations: { include: { requirement: true } } } } } });
      if (!purchaseOrder || !["ISSUED", "PARTIAL_RECEIVED", "RETURN_IN_PROGRESS"].includes(purchaseOrder.status)) throw new BadRequestException("采购单尚未下达或已经收货完成");
      const lineMap = new Map(purchaseOrder.lines.map((line) => [line.id, line]));
      for (const inputLine of input.lines) {
        const line = lineMap.get(inputLine.purchaseOrderLineId);
        if (!line) throw new BadRequestException("到货明细不属于当前采购单");
        const delivered = Number(inputLine.deliveredQty);
        const accepted = Number(inputLine.acceptedQty);
        const rejected = Number(inputLine.rejectedQty ?? 0);
        const remaining = Number(line.quantity) - Number(line.receivedQty) - Number(line.cancelledQty);
        if (delivered <= 0 || accepted < 0 || rejected < 0 || round4(accepted + rejected) !== round4(delivered) || delivered > remaining) throw new BadRequestException(`到货数量无效或超过剩余数量：${line.id}`);
      }
      const receiptNo = receiptNumber();
      const hasRejected = input.lines.some((line) => Number(line.rejectedQty ?? 0) > 0);
      const receipt = await tx.goodsReceipt.create({ data: { receiptNo, purchaseOrderId: purchaseOrder.id, status: hasRejected ? "PARTIAL_REJECTED" : "ACCEPTED", supplierDeliveryNo: input.supplierDeliveryNo, deliveryAttachmentIds: input.deliveryAttachmentIds ?? [], receivedBy: employee.id, receivedAt: new Date(input.receivedAt), note: input.note } });
      const affectedOrders = new Set<string>();
      for (const inputLine of input.lines) {
        const line = lineMap.get(inputLine.purchaseOrderLineId)!;
        const accepted = Number(inputLine.acceptedQty);
        const rejected = Number(inputLine.rejectedQty ?? 0);
        const receiptLine = await tx.goodsReceiptLine.create({ data: { receiptId: receipt.id, purchaseOrderLineId: line.id, itemId: line.itemId, deliveredQty: inputLine.deliveredQty, acceptedQty: accepted, rejectedQty: rejected, shortageQty: Number(inputLine.shortageQty ?? 0), photoAttachmentIds: inputLine.photoAttachmentIds ?? [], qualityAttachmentIds: inputLine.qualityAttachmentIds ?? [], note: inputLine.note } });
        await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQty: { increment: accepted } } });
        if (accepted > 0) {
          await tx.inventoryItem.update({ where: { id: line.itemId }, data: { onHand: { increment: accepted }, reserved: { increment: accepted } } });
          await tx.stockMovement.create({ data: { itemId: line.itemId, quantity: accepted, direction: "RECEIVE", referenceType: "GOODS_RECEIPT", referenceId: receipt.id, note: inputLine.note } });
        }
        let remainingAccepted = accepted;
        for (const allocation of line.allocations) {
          if (remainingAccepted <= 0) break;
          const allocationRemaining = Number(allocation.quantity) - Number(allocation.receivedQty);
          const assigned = Math.min(remainingAccepted, allocationRemaining);
          if (assigned <= 0) continue;
          await tx.purchaseAllocation.update({ where: { id: allocation.id }, data: { receivedQty: { increment: assigned } } });
          await tx.purchaseRequirement.update({ where: { id: allocation.requirementId }, data: { receivedQty: { increment: assigned } } });
          if (allocation.requirement.materialLineId) {
            const materialLine = await tx.materialLine.update({ where: { id: allocation.requirement.materialLineId }, data: { receivedQty: { increment: assigned } } });
            await tx.stockReservation.create({ data: { orderId: allocation.orderId ?? "STANDARD-STOCK", materialLineId: materialLine.id, itemId: line.itemId, quantity: assigned, reservedBy: employee.id } });
          }
          if (allocation.orderId) affectedOrders.add(allocation.orderId);
          remainingAccepted = round4(remainingAccepted - assigned);
        }
        if (rejected > 0) await tx.purchaseReturn.create({ data: { purchaseOrderLineId: line.id, receiptLineId: receiptLine.id, quantity: rejected, resolution: "REPLACE", createdBy: employee.id, note: inputLine.note } });
        const refreshedLine = await tx.purchaseOrderLine.findUniqueOrThrow({ where: { id: line.id } });
        if (Number(refreshedLine.receivedQty) + Number(refreshedLine.cancelledQty) >= Number(refreshedLine.quantity)) {
          await tx.purchaseReturn.updateMany({ where: { purchaseOrderLineId: line.id, status: "WAITING_REPLACEMENT" }, data: { status: "COMPLETED", resolution: "REPLACEMENT_RECEIVED", completedAt: new Date(), note: "补货已通过到货验收并入库" } });
        }
      }
      for (const line of purchaseOrder.lines) {
        const refreshed = await tx.purchaseOrderLine.findUniqueOrThrow({ where: { id: line.id } });
        for (const allocation of line.allocations) {
          const requirement = await tx.purchaseRequirement.findUniqueOrThrow({ where: { id: allocation.requirementId } });
          const status = Number(requirement.receivedQty) >= Number(requirement.purchaseQty) ? "RECEIVED" : Number(requirement.receivedQty) > 0 ? "PARTIAL_RECEIVED" : requirement.status;
          await tx.purchaseRequirement.update({ where: { id: requirement.id }, data: { status } });
          if (requirement.materialLineId) {
            const materialLine = await tx.materialLine.findUniqueOrThrow({ where: { id: requirement.materialLineId } });
            const fulfilled = Number(materialLine.stockQty) + Number(materialLine.receivedQty);
            await tx.materialLine.update({ where: { id: materialLine.id }, data: { status: fulfilled >= Number(materialLine.purchaseQty) ? "READY" : fulfilled > 0 ? "PARTIAL_RECEIVED" : "PURCHASE_REQUIRED" } });
          }
        }
        void refreshed;
      }
      const refreshedLines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: purchaseOrder.id } });
      const fullyReceived = refreshedLines.every((line) => Number(line.receivedQty) + Number(line.cancelledQty) >= Number(line.quantity));
      const partiallyReceived = refreshedLines.some((line) => Number(line.receivedQty) > 0);
      await tx.purchaseOrder.update({ where: { id: purchaseOrder.id }, data: { status: hasRejected ? "RETURN_IN_PROGRESS" : fullyReceived ? "RECEIVED" : partiallyReceived ? "PARTIAL_RECEIVED" : purchaseOrder.status } });
      for (const orderId of affectedOrders) await this.refreshOrderReadiness(tx, orderId, employee.id);
      return tx.goodsReceipt.findUniqueOrThrow({ where: { id: receipt.id }, include: { lines: { include: { item: true } }, purchaseOrder: true } });
    });
  }

  async resolveReturn(id: string, employee: Employee, input: { resolution: "RETURNED" | "WAITING_REPLACEMENT" | "REPLACEMENT_RECEIVED"; note?: string }) {
    requireRole(employee, ["WAREHOUSE", "PROCUREMENT", "CHAIRMAN"], "只有仓库或采购可以处理退货/补货任务");
    return this.prisma.$transaction(async (tx) => {
      const returnTask = await tx.purchaseReturn.findUnique({ where: { id }, include: { purchaseOrderLine: true } });
      if (!returnTask || !["OPEN", "WAITING_REPLACEMENT"].includes(returnTask.status)) throw new BadRequestException("退货/补货任务不存在或已经完成");
      if (input.resolution === "REPLACEMENT_RECEIVED") throw new BadRequestException("补货完成必须通过采购单分批收货验收，不能手工直接完成");
      const complete = input.resolution === "RETURNED";
      await tx.purchaseReturn.update({ where: { id }, data: { resolution: input.resolution, status: complete ? "COMPLETED" : "WAITING_REPLACEMENT", note: input.note, completedAt: complete ? new Date() : null } });
      if (input.resolution === "RETURNED") await tx.purchaseOrderLine.update({ where: { id: returnTask.purchaseOrderLineId }, data: { cancelledQty: { increment: returnTask.quantity } } });
      if (complete) {
        const openReturns = await tx.purchaseReturn.count({ where: { purchaseOrderLine: { purchaseOrderId: returnTask.purchaseOrderLine.purchaseOrderId }, status: { in: ["OPEN", "WAITING_REPLACEMENT"] } } });
        if (openReturns === 0) {
          const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: returnTask.purchaseOrderLine.purchaseOrderId } });
          const fullyAccounted = lines.every((line) => Number(line.receivedQty) + Number(line.cancelledQty) >= Number(line.quantity));
          const hasCancelled = lines.some((line) => Number(line.cancelledQty) > 0);
          await tx.purchaseOrder.update({ where: { id: returnTask.purchaseOrderLine.purchaseOrderId }, data: { status: fullyAccounted ? hasCancelled ? "PARTIALLY_CANCELLED" : "RECEIVED" : "PARTIAL_RECEIVED" } });
        }
      }
      const allocations = await tx.purchaseAllocation.findMany({ where: { purchaseOrderLineId: returnTask.purchaseOrderLineId } });
      for (const allocation of allocations) {
        if (!allocation.orderId) continue;
        await tx.orderEvent.create({ data: { orderId: allocation.orderId, actorId: employee.id, type: input.resolution === "RETURNED" ? "COMPLETE_PURCHASE_RETURN" : "WAIT_PURCHASE_REPLACEMENT", title: input.resolution === "RETURNED" ? "不合格品已退回供应商" : "供应商已确认补货", description: input.note || `数量 ${returnTask.quantity}`, fromStage: "MATERIALS", toStage: "MATERIALS", metadata: { purchaseReturnId: id } } });
      }
      return { ok: true };
    });
  }

  async cancelAndRebuild(materialVersionId: string, employee: Employee, input: { reason: string; supplierResolution?: unknown; receivedResolution?: unknown }) {
    requireRole(employee, ["ORDER_ADMIN", "CHAIRMAN"], "只有订单管理员或董事长管理员可以撤销物料版");
    if (!input.reason?.trim()) throw new BadRequestException("整版撤销原因必填");
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.materialListVersion.findUnique({ where: { id: materialVersionId }, select: { orderId: true } });
      if (!target) throw new BadRequestException("物料版不存在");
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${target.orderId} FOR UPDATE`;
      const version = await tx.materialListVersion.findUnique({ where: { id: materialVersionId }, include: { order: true, lines: true, requirements: { include: { allocations: { include: { purchaseOrderLine: true } } } } } });
      if (!version || !["PUBLISHED", "WAREHOUSE_RELEASED"].includes(version.status)) throw new BadRequestException("物料版不存在或已经撤销");
      if (["PRODUCTION", "INSTALLATION_APPLICATION", "DELIVERY", "INSTALLATION", "ACCEPTANCE", "BUSINESS_COMPLETE"].includes(version.order.stage)) throw new BadRequestException("订单已领料或开始生产，不能普通撤销；请转异常/责任处理或创建补单");
      const hasOrdered = version.requirements.some((requirement) => requirement.allocations.length > 0);
      const hasReceived = version.lines.some((line) => Number(line.receivedQty) > 0);
      if (hasOrdered && !input.supplierResolution) throw new BadRequestException("存在已生成采购单，必须登记供应商取消确认结果");
      if (hasReceived && !input.receivedResolution) throw new BadRequestException("存在已到货物料，必须选择退回供应商或保留为库存/余料");
      const reservations = await tx.stockReservation.findMany({ where: { materialLineId: { in: version.lines.map((line) => line.id) }, status: "ACTIVE" } });
      for (const reservation of reservations) {
        await tx.inventoryItem.update({ where: { id: reservation.itemId }, data: { reserved: { decrement: reservation.quantity } } });
        await tx.stockReservation.update({ where: { id: reservation.id }, data: { status: "CANCELLED", releasedAt: new Date() } });
        await tx.stockMovement.create({ data: { itemId: reservation.itemId, orderId: version.orderId, materialLineId: reservation.materialLineId, quantity: reservation.quantity, direction: "RELEASE", referenceType: "MATERIAL_CANCELLATION", referenceId: version.id, note: input.reason } });
      }
      if (input.receivedResolution === "RETURN_SUPPLIER") {
        for (const line of version.lines) {
          const receivedQty = Number(line.receivedQty);
          if (receivedQty <= 0 || !line.itemId) continue;
          await tx.inventoryItem.update({ where: { id: line.itemId }, data: { onHand: { decrement: receivedQty } } });
          await tx.stockMovement.create({ data: { itemId: line.itemId, orderId: version.orderId, materialLineId: line.id, quantity: receivedQty, direction: "RETURN", referenceType: "MATERIAL_CANCELLATION", referenceId: version.id, note: input.reason } });
        }
      }
      const affectedPurchaseOrderIds = new Set<string>();
      for (const requirement of version.requirements) {
        for (const allocation of requirement.allocations) {
          const remainingAllocation = round4(Number(allocation.quantity) - Number(allocation.receivedQty));
          if (remainingAllocation > 0) await tx.purchaseOrderLine.update({ where: { id: allocation.purchaseOrderLine.id }, data: { cancelledQty: { increment: remainingAllocation } } });
          affectedPurchaseOrderIds.add(allocation.purchaseOrderLine.purchaseOrderId);
        }
      }
      for (const purchaseOrderId of affectedPurchaseOrderIds) {
        const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId } });
        const fullyCancelledOrReceived = lines.every((line) => Number(line.receivedQty) + Number(line.cancelledQty) >= Number(line.quantity));
        const hasReceivedLine = lines.some((line) => Number(line.receivedQty) > 0);
        await tx.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status: fullyCancelledOrReceived && !hasReceivedLine ? "TERMINATED" : "PARTIALLY_CANCELLED", note: `${input.reason}；供应商处理：${String(input.supplierResolution ?? "不涉及")}` } });
      }
      await tx.purchaseRequirement.updateMany({ where: { materialVersionId: version.id }, data: { status: "CANCELLED" } });
      await tx.materialLine.updateMany({ where: { materialVersionId: version.id }, data: { status: "CANCELLED" } });
      await tx.materialListVersion.update({ where: { id: version.id }, data: { status: "CANCELLED" } });
      await tx.materialVersionCancellation.create({ data: { orderId: version.orderId, materialVersionId: version.id, reason: input.reason, supplierResolution: input.supplierResolution as Prisma.InputJsonValue, receivedResolution: input.receivedResolution as Prisma.InputJsonValue, requestedBy: employee.id } });
      await tx.order.update({ where: { id: version.orderId }, data: { stage: "TECHNICAL", procurementPlanned: false, productionReady: false, materialSubstatus: "物料版已撤销·待重新拆单", currentOwnerLabel: "技术部", nextAction: "重新提交完整三件套与物料版" } });
      await tx.task.updateMany({ where: { orderId: version.orderId, status: { in: ["PENDING", "OVERDUE"] } }, data: { status: "CANCELLED" } });
      await tx.orderEvent.create({ data: { orderId: version.orderId, actorId: employee.id, type: "CANCEL_MATERIAL_VERSION", title: "物料版已冲销并整单重建", description: input.reason, fromStage: "MATERIALS", toStage: "TECHNICAL", metadata: { materialVersionId: version.id, supplierResolution: input.supplierResolution as Prisma.InputJsonValue, receivedResolution: input.receivedResolution as Prisma.InputJsonValue } } });
      return { ok: true, orderId: version.orderId };
    });
  }

  async confirmRequirementReplenishment(id: string, employee: Employee) {
    requireRole(employee, ["PROCUREMENT", "CHAIRMAN"], "只有采购可以确认常备品补货建议");
    const requirement = await this.prisma.purchaseRequirement.findUnique({ where: { id }, include: { item: true } });
    if (!requirement || requirement.mode !== "STOCK_STANDARD" || requirement.status !== "REPLENISHMENT_SUGGESTED") throw new BadRequestException("该记录不是待确认的常备品补货建议");
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseRequirement.update({ where: { id }, data: { status: "PURCHASE_REQUIRED" } });
      if (requirement.orderId) await tx.orderEvent.create({ data: { orderId: requirement.orderId, actorId: employee.id, type: "CONFIRM_STANDARD_REPLENISHMENT", title: "常备品补货建议已确认", description: `${requirement.item.name} · ${requirement.purchaseQty} ${requirement.item.unit}`, fromStage: "MATERIALS", toStage: "MATERIALS", metadata: { requirementId: id } } });
      return updated;
    });
  }

  async confirmStockReplenishment(itemId: string, employee: Employee) {
    requireRole(employee, ["PROCUREMENT", "CHAIRMAN"], "只有采购可以确认常备库存补货");
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findUnique({ where: { id: itemId } });
      if (!item || item.mode !== "STOCK_STANDARD" || !item.approvedStandard || !item.active) throw new BadRequestException("物料不是已批准的常备品");
      const existing = await tx.purchaseRequirement.findFirst({ where: { itemId, orderId: null, status: { in: ["PURCHASE_REQUIRED", "QUOTING", "PRICE_REVIEW", "APPROVED", "ORDERED", "PARTIAL_RECEIVED"] } } });
      if (existing) throw new BadRequestException("该常备品已有进行中的补货需求");
      const available = Number(item.onHand) - Number(item.reserved);
      if (available >= Number(item.minimumStock ?? 0)) throw new BadRequestException("当前可用库存未低于最低库存");
      const purchaseQty = round4(Math.max(Number(item.replenishmentLot ?? 0), Number(item.targetStock ?? 0) - available));
      if (purchaseQty <= 0) throw new BadRequestException("库存策略未产生有效补货数量，请先调整最低/目标库存策略");
      return tx.purchaseRequirement.create({ data: { itemId, mode: "STOCK_STANDARD", requestedQty: purchaseQty, purchaseQty, status: "PURCHASE_REQUIRED", source: "STANDARD_STOCK", requiredAt: addInternalWorkingDays(new Date(), 3), riskLevel: "NORMAL", allocation: { type: "STANDARD_STOCK_REPLENISHMENT" } } });
    });
  }

  async proposeStockPolicy(itemId: string, employee: Employee, input: { minimumStock?: number; targetStock?: number; replenishmentLot?: number; reason: string }) {
    requireRole(employee, ["WAREHOUSE", "PROCUREMENT", "CHAIRMAN"], "只有仓库或采购可以提出常备库存策略变更");
    if (!input.reason?.trim()) throw new BadRequestException("变更原因必填");
    const latest = await this.prisma.stockPolicyVersion.findFirst({ where: { itemId }, orderBy: { version: "desc" } });
    return this.prisma.stockPolicyVersion.create({ data: { itemId, version: (latest?.version ?? 0) + 1, minimumStock: input.minimumStock, targetStock: input.targetStock, replenishmentLot: input.replenishmentLot, reason: input.reason, proposedBy: employee.id } });
  }

  async reviewStockPolicy(id: string, employee: Employee, input: { approved: boolean }) {
    requireRole(employee, ["CHAIRMAN"], "只有董事长管理员可以批准常备库存策略");
    return this.prisma.$transaction(async (tx) => {
      const change = await tx.stockPolicyVersion.findUniqueOrThrow({ where: { id } });
      if (change.status !== "PROPOSED") throw new BadRequestException("该库存策略变更已经处理");
      await tx.stockPolicyVersion.update({ where: { id }, data: { status: input.approved ? "APPROVED" : "REJECTED", approvedBy: employee.id, reviewedAt: new Date() } });
      if (input.approved) await tx.inventoryItem.update({ where: { id: change.itemId }, data: { minimumStock: change.minimumStock, targetStock: change.targetStock, replenishmentLot: change.replenishmentLot, approvedStandard: true, mode: "STOCK_STANDARD" } });
      return { ok: true };
    });
  }

  private async refreshOrderReadiness(tx: Prisma.TransactionClient, orderId: string, actorId: string) {
    const version = await tx.materialListVersion.findFirst({ where: { orderId, status: "WAREHOUSE_RELEASED" }, include: { lines: true }, orderBy: { version: "desc" } });
    if (!version) return;
    const productionReady = version.lines.filter((line) => line.readinessClass === "PRODUCTION_REQUIRED").every((line) => Number(line.stockQty) + Number(line.receivedQty) >= Number(line.purchaseQty));
    const allReady = version.lines.every((line) => Number(line.stockQty) + Number(line.receivedQty) >= Number(line.purchaseQty));
    await tx.materialListVersion.update({ where: { id: version.id }, data: { productionReleasedAt: productionReady ? new Date() : null } });
    await tx.order.update({ where: { id: orderId }, data: { productionReady, hardwareReady: allReady, materialSubstatus: allReady ? "全部物料齐备" : productionReady ? "生产料齐备·交付料采购中" : "生产料采购中", currentOwnerLabel: productionReady ? "订单管理员" : "采购部", nextAction: productionReady ? "生产必需料齐备，可下达四车间" : "等待生产必需料到货" } });
    if (productionReady) {
      await tx.task.updateMany({ where: { orderId, stage: "MATERIALS", status: { in: ["PENDING", "OVERDUE"] } }, data: { status: "COMPLETE", completedAt: new Date() } });
      await tx.orderEvent.create({ data: { orderId, actorId, type: "PRODUCTION_MATERIAL_READY", title: "生产必需料已齐备", description: allReady ? "全部物料已齐备" : "五金等交付物料继续采购，不阻断四车间", fromStage: "MATERIALS", toStage: "MATERIALS", metadata: { materialVersionId: version.id, allReady } } });
    }
  }

  private async orderMaterialProjection(tx: Prisma.TransactionClient, orderId: string) {
    return tx.materialListVersion.findFirst({ where: { orderId }, include: { order: true, lines: { include: { item: true, requirements: true, reservations: true }, orderBy: { sourceRow: "asc" } } }, orderBy: { version: "desc" } });
  }

  private async upsertProcurementTask(tx: Prisma.TransactionClient, orderId: string, title: string, days: number, role: "PROCUREMENT" | "FINANCE") {
    return this.upsertTask(tx, orderId, title, days, role, `${orderId}:MATERIALS:${role}`);
  }

  private async upsertTask(tx: Prisma.TransactionClient, orderId: string, title: string, days: number, role: "PROCUREMENT" | "FINANCE", uniqueKey: string) {
    const owner = await tx.employee.findFirst({ where: { role, active: true }, orderBy: { employeeNo: "asc" } });
    const dueAt = addInternalWorkingDays(new Date(), days);
    const reminderAt = previousInternalWorkday(dueAt);
    reminderAt.setHours(17, 0, 0, 0);
    return tx.task.upsert({ where: { uniqueKey }, create: { orderId, ownerId: owner?.id, department: owner?.department ?? (role === "FINANCE" ? "财务部" : "采购部"), title, stage: "MATERIALS", dueAt, reminderAt, uniqueKey }, update: { ownerId: owner?.id, title, dueAt, reminderAt, status: "PENDING", completedAt: null, reminderSentAt: null, escalatedAt: null } });
  }

  private async notifyRole(tx: Prisma.TransactionClient, role: "FINANCE", uniquePrefix: string, title: string, body: string) {
    const employees = await tx.employee.findMany({ where: { role, active: true } });
    for (const employee of employees) await tx.notification.upsert({ where: { uniqueKey: `${uniquePrefix}:${employee.id}` }, create: { employeeId: employee.id, uniqueKey: `${uniquePrefix}:${employee.id}`, level: "WARNING", title, body }, update: { title, body, readAt: null } });
  }
}

function requireRole(employee: Employee, roles: string[], message: string) {
  if (!roles.includes(employee.role)) throw new ForbiddenException(message);
}

function round4(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function poNumber() {
  const now = new Date();
  return `PO-${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${randomInt(1000, 10000)}`;
}

function receiptNumber() {
  const now = new Date();
  return `GR-${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${randomInt(1000, 10000)}`;
}

function latestDate(values: Date[]) {
  return new Date(Math.max(...values.map((value) => value.getTime())));
}

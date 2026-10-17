import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AttachmentVault } from "./attachment-vault.js";
import { parseMaterialWorkbook, validatePublishedMaterialLines, type ImportedMaterialLine, type MaterialImportIssue } from "./domain/material-import.js";
import { addInternalWorkingDays } from "./domain/rules.js";
import { PRODUCTION_ROUTE_LABELS, type ProductionRouteKind } from "./domain/route-execution.js";
import { WORKSHOP_LABELS, WORKSHOP_PROCESS_TEMPLATES } from "./domain/workshop-processes.js";
import type { MaterialTemplateType } from "./domain/types.js";
import type { Employee, Order, Prisma } from "./generated/prisma/client.js";
import { MaterialCostService } from "./material-cost.service.js";
import { requireOrder, requireAttachment } from "./order-access.js";
import { PrismaService } from "./prisma.service.js";
import { OutsourceFulfillmentService } from "./outsource-fulfillment.service.js";

type Tx = Prisma.TransactionClient;

@Injectable()
export class MaterialPackageService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AttachmentVault) private readonly vault: AttachmentVault, @Inject(MaterialCostService) private readonly costs: MaterialCostService, @Inject(OutsourceFulfillmentService) private readonly outsource: OutsourceFulfillmentService) {}

  async preview(orderId: string, productionAreaId: string, attachmentId: string, templateType: MaterialTemplateType, employee: Employee) {
    this.requireSplitter(employee);
    const order = await requireOrder(this.prisma, orderId, employee);
    if (order.stage !== "TECHNICAL") throw new BadRequestException("只有处于技术拆单阶段的订单可以保存物料解析草稿");
    const area = await this.prisma.productionArea.findFirst({ where: { id: productionAreaId, orderId, cancelledAt: null } });
    if (!area) throw new BadRequestException("请选择当前订单的有效生产区域");
    await requireAttachment(this.prisma, attachmentId, employee);
    const { attachment, buffer } = await this.vault.read(attachmentId);
    if (attachment.orderId !== orderId || (attachment.productionAreaId && attachment.productionAreaId !== area.id)) throw new BadRequestException("物料附件不属于当前生产区域");
    if (attachment.category !== templateType) throw new BadRequestException("附件类别与选择的物料模板不一致");
    const standards = await this.prisma.inventoryItem.findMany({ where: { mode: "STOCK_STANDARD", approvedStandard: true, active: true }, select: { name: true } });
    let parsed;
    try {
      parsed = parseMaterialWorkbook(buffer, attachment.originalName, standards.map((item) => item.name), templateType);
    } catch (error) {
      const message = error instanceof Error ? error.message : "物料文件解析失败";
      parsed = {
        templateType, parserVersion: "V3.0", fingerprintVersion: "FORMAL-XLS-20260831-V1", sourceProductionNumber: null, valid: false,
        sheetName: templateType === "HARDWARE_MATERIALS" ? "物料单" as const : "下料单" as const, rawRows: [], lines: [],
        errors: [{ code: "FINGERPRINT_MISMATCH", row: 0, message }] as MaterialImportIssue[],
      };
    }
    const errors = [...parsed.errors];
    if (parsed.sourceProductionNumber && parsed.sourceProductionNumber !== area.productionNumber) errors.push({
      code: "PRODUCTION_NUMBER_MISMATCH", row: 0,
      message: `文件生产编号 ${parsed.sourceProductionNumber} 与${area.name}区域 ${area.productionNumber} 不一致`, rawValue: parsed.sourceProductionNumber,
    });
    const valid = parsed.valid && errors.length === 0;
    const batch = await this.prisma.$transaction(async (tx) => {
      await tx.materialImportBatch.updateMany({
        where: { productionAreaId, templateType, technicalPackageId: null, status: "DRAFT" },
        data: { status: "CANCELLED", cancelledBy: employee.id, cancelledAt: new Date(), cancelReason: "同类别重新上传" },
      });
      return tx.materialImportBatch.create({
        data: {
          orderId, productionAreaId, templateType, parserVersion: parsed.parserVersion, fingerprintVersion: parsed.fingerprintVersion,
          sourceProductionNumber: parsed.sourceProductionNumber, valid, sourceAttachmentId: attachment.id,
          fileName: attachment.originalName, sheetName: parsed.sheetName, rawRows: parsed.rawRows as Prisma.InputJsonValue,
          normalizedRows: parsed.lines as unknown as Prisma.InputJsonValue, errors: errors as Prisma.InputJsonValue, createdBy: employee.id,
        },
      });
    });
    return this.previewResponse(batch);
  }

  async listDrafts(orderId: string, productionAreaId: string, employee: Employee) {
    this.requireSplitter(employee);
    await requireOrder(this.prisma, orderId, employee);
    const area = await this.prisma.productionArea.findFirst({ where: { id: productionAreaId, orderId, cancelledAt: null }, select: { id: true } });
    if (!area) throw new BadRequestException("请选择当前订单的有效生产区域");
    const batches = await this.prisma.materialImportBatch.findMany({
      where: { orderId, productionAreaId, technicalPackageId: null, status: "DRAFT" },
      orderBy: { createdAt: "desc" },
    });
    const latest = new Map<MaterialTemplateType, typeof batches[number]>();
    for (const batch of batches) if (!latest.has(batch.templateType)) latest.set(batch.templateType, batch);
    return [...latest.values()].map((batch) => this.previewResponse(batch));
  }

  async cancelDraft(id: string, employee: Employee) {
    this.requireSplitter(employee);
    const batch = await this.prisma.materialImportBatch.findUnique({ where: { id } });
    if (!batch || batch.technicalPackageId || batch.status !== "DRAFT") throw new NotFoundException("当前物料解析草稿不存在");
    const order = await requireOrder(this.prisma, batch.orderId, employee);
    if (order.stage !== "TECHNICAL") throw new BadRequestException("当前订单已离开技术拆单阶段，不能移除解析草稿");
    const cancelled = await this.prisma.materialImportBatch.update({
      where: { id }, data: { status: "CANCELLED", cancelledBy: employee.id, cancelledAt: new Date(), cancelReason: "技术人员移除当前类别" },
    });
    return { id: cancelled.id, status: cancelled.status };
  }

  async submit(tx: Tx, order: Order, employee: Employee, payload: Record<string, unknown>) {
    this.requireSplitter(employee);
    const productionAreaId = String(payload.productionAreaId ?? "");
    const area = await tx.productionArea.findFirst({ where: { id: productionAreaId, orderId: order.id, cancelledAt: null } });
    if (!area) throw new BadRequestException("请选择当前订单的有效生产区域");
    const latest = await tx.technicalPackageVersion.findFirst({ where: { productionAreaId: area.id }, orderBy: { version: "desc" } });
    if (latest?.status === "SUBMITTED") throw new BadRequestException(`${area.name}技术包已经提交，请勿重复提交`);
    const haixunAttachmentIds = supportingAttachments(payload.haixunAttachmentIds, "海迅单");
    const decompositionAttachmentIds = supportingAttachments(payload.decompositionAttachmentIds, "分解单");
    const workbookAttachments: Array<{ type: MaterialTemplateType; id: string }> = [
      { type: "HARDWARE_MATERIALS" as const, id: oneAttachmentOptional(payload.hardwareMaterialAttachmentIds, "五金物料表") },
      { type: "PAINT_WOOD" as const, id: oneAttachmentOptional(payload.paintWoodAttachmentIds, "油漆门板/实木分解表") },
      { type: "SOLID_WOOD_DOOR" as const, id: oneAttachmentOptional(payload.solidWoodDoorAttachmentIds, "实木房门分解表") },
      { type: "VENEER_DOOR" as const, id: oneAttachmentOptional(payload.veneerDoorAttachmentIds, "饰面板房门分解表") },
    ].filter((entry): entry is { type: MaterialTemplateType; id: string } => Boolean(entry.id));
    const importBatchIds = Array.isArray(payload.materialImportIds) ? payload.materialImportIds.map(String) : [];
    if (importBatchIds.length < 1 || importBatchIds.length > 4) throw new BadRequestException("请完成实际存在的1至4类Excel解析预览");
    if (workbookAttachments.length !== importBatchIds.length) throw new BadRequestException("上传文件类别与解析预览批次数量不一致");
    const supportingAttachmentIds = [...haixunAttachmentIds, ...decompositionAttachmentIds];
    const workbookAttachmentIds = workbookAttachments.map((entry) => entry.id);
    const allAttachmentIds = [...supportingAttachmentIds, ...workbookAttachmentIds];
    const attachments = await tx.attachment.findMany({ where: { id: { in: allAttachmentIds }, orderId: order.id } });
    if (attachments.length !== allAttachmentIds.length) throw new BadRequestException("已选择的海迅资料、分解单及物料Excel必须全部属于当前订单");
    if (attachments.some((attachment) => workbookAttachmentIds.includes(attachment.id) && attachment.productionAreaId && attachment.productionAreaId !== area.id)) throw new BadRequestException("物料Excel必须属于当前生产区域");
    await tx.attachment.updateMany({ where: { id: { in: workbookAttachmentIds }, productionAreaId: null }, data: { productionAreaId: area.id } });
    const batches = await tx.materialImportBatch.findMany({ where: { id: { in: importBatchIds }, orderId: order.id, productionAreaId: area.id, technicalPackageId: null, status: "DRAFT", valid: true } });
    if (batches.length !== importBatchIds.length || new Set(batches.map((batch) => batch.templateType)).size !== batches.length) throw new BadRequestException("物料预览批次无效、重复、已移除或已经使用");
    for (const expected of workbookAttachments) if (!batches.some((batch) => batch.templateType === expected.type && batch.sourceAttachmentId === expected.id)) throw new BadRequestException(`${expected.type}预览批次与上传文件不一致`);
    const lines = coerceLines(payload.materialLines ?? batches.flatMap((batch) => Array.isArray(batch.normalizedRows) ? batch.normalizedRows : []));
    try {
      validatePublishedMaterialLines(lines);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "物料明细尚未完成核定");
    }
    const panelEnabled = payload.panelEnabled === true;
    const woodPaintEnabled = payload.woodPaintEnabled === true;
    const veneerRequired = woodPaintEnabled && payload.veneerRequired === true;
    if (!panelEnabled && !woodPaintEnabled) throw new BadRequestException("生产区域必须至少选择板式或木工油漆路线");
    const legacyAssemblyQty = Number(payload.assemblyQty);
    const panelAssemblyPlanQty = panelEnabled
      ? positivePlan(payload.panelAssemblyQty ?? (!woodPaintEnabled ? legacyAssemblyQty : undefined), "板式路线组装")
      : 0;
    const woodPaintAssemblyPlanQty = woodPaintEnabled
      ? positivePlan(payload.woodPaintAssemblyQty ?? (!panelEnabled ? legacyAssemblyQty : undefined), "实木油漆路线组装")
      : 0;
    const technicalPackage = await tx.technicalPackageVersion.create({
      data: {
        orderId: order.id,
        productionAreaId: area.id,
        version: (latest?.version ?? 0) + 1,
        designVersion: String(payload.designVersion ?? payload.haixunVersion ?? `V${(latest?.version ?? 0) + 1}`),
        haixunAttachmentId: haixunAttachmentIds[0] ?? null,
        decompositionAttachmentId: decompositionAttachmentIds[0] ?? null,
        haixunAttachmentIds,
        decompositionAttachmentIds,
        materialAttachmentId: workbookAttachments[0]!.id,
        panelEnabled,
        woodPaintEnabled,
        veneerRequired,
        panelPlanQty: panelEnabled ? positivePlan(payload.panelQty, "板式") : 0,
        woodPlanQty: woodPaintEnabled ? positivePlan(payload.woodQty, "木工") : 0,
        paintPlanQty: woodPaintEnabled ? positivePlan(payload.paintQty, "油漆") : 0,
        assemblyPlanQty: panelAssemblyPlanQty + woodPaintAssemblyPlanQty,
        panelAssemblyPlanQty: panelEnabled ? panelAssemblyPlanQty : null,
        woodPaintAssemblyPlanQty: woodPaintEnabled ? woodPaintAssemblyPlanQty : null,
        validationSummary: String(payload.validationSummary ?? "").trim(),
        rowCount: Number(payload.rowCount ?? lines.length),
        submittedBy: employee.id,
      },
    });
    for (const batch of batches) await tx.materialImportBatch.update({ where: { id: batch.id }, data: { technicalPackageId: technicalPackage.id, normalizedRows: lines.filter((line) => line.templateType === batch.templateType) as unknown as Prisma.InputJsonValue } });
    await tx.productionArea.update({ where: { id: area.id }, data: { status: "TECHNICAL_SUBMITTED" } });

    return { technicalPackage, submissionSetId: null };
  }

  async finalize(tx: Tx, order: Order, employee: Employee) {
    this.requireSplitter(employee);
    if (order.stage !== "TECHNICAL") throw new BadRequestException("只有技术拆单阶段可以提交整单拆单集合");
    const activeAreas = await tx.productionArea.findMany({
      where: { orderId: order.id, cancelledAt: null },
      include: { technicalPackages: { where: { status: "SUBMITTED", submissionSetId: null }, orderBy: { version: "desc" }, take: 1 } },
      orderBy: { sequence: "asc" },
    });
    if (!activeAreas.length) throw new BadRequestException("至少创建并完成一个生产区域后才能提交整单拆单");
    const unfinished = activeAreas.filter((area) => area.technicalPackages.length !== 1);
    if (unfinished.length) throw new BadRequestException(`以下区域尚未完成当前技术包：${unfinished.map((area) => area.name).join("、")}`);
    const latestSet = await tx.technicalSubmissionSet.findFirst({ where: { orderId: order.id }, orderBy: { version: "desc" } });
    const submissionSet = await tx.technicalSubmissionSet.create({ data: { orderId: order.id, version: (latestSet?.version ?? 0) + 1, submittedBy: employee.id } });
    const outsourceRequirement = await this.outsource.finalize(tx, order, submissionSet.id);
    const packages = activeAreas.map((area) => area.technicalPackages[0]!);
    await tx.technicalPackageVersion.updateMany({ where: { id: { in: packages.map((item) => item.id) } }, data: { submissionSetId: submissionSet.id } });
    const now = new Date();
    await tx.productionArea.updateMany({ where: { orderId: order.id, cancelledAt: null }, data: { status: "LOCKED_FOR_REVIEW", lockedAt: now } });
    await tx.order.update({ where: { id: order.id }, data: { technicalAreasLockedAt: now } });
    return { submissionSet, outsourceRequirement, areas: activeAreas.map((area) => ({ id: area.id, name: area.name, productionNumber: area.productionNumber, technicalPackageId: area.technicalPackages[0]!.id })) };
  }

  async approve(tx: Tx, orderId: string, employee: Employee, input: { comment?: string }) {
    this.requireReviewer(employee);
    const submissionSet = await tx.technicalSubmissionSet.findFirst({
      where: { orderId, status: "SUBMITTED" },
      include: { packages: { include: { materialImports: true, productionArea: true } } },
      orderBy: { version: "desc" },
    });
    if (!submissionSet?.packages.length || submissionSet.packages.some((technicalPackage) => technicalPackage.materialImports.length < 1 || technicalPackage.materialImports.length > 4 || technicalPackage.materialImports.some((batch) => !batch.valid))) throw new BadRequestException("整单技术提交集合缺少有效区域物料预览");
    if (submissionSet.packages.some((technicalPackage) => technicalPackage.submittedBy === employee.id)) throw new ForbiddenException("拆单提交人与技术审单的订单管理员必须是不同员工");
    const materialVersions = [];
    for (const technicalPackage of submissionSet.packages) {
      if (!technicalPackage.productionAreaId || !technicalPackage.productionArea) throw new BadRequestException("技术包缺少生产区域归属");
      const lines = coerceLines(technicalPackage.materialImports.flatMap((batch) => Array.isArray(batch.normalizedRows) ? batch.normalizedRows : []));
      try { validatePublishedMaterialLines(lines); }
      catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "物料明细尚未完成核定"); }
      const latestVersion = await tx.materialListVersion.findFirst({ where: { productionAreaId: technicalPackage.productionAreaId }, orderBy: { version: "desc" } });
      const materialVersion = await tx.materialListVersion.create({ data: { orderId, productionAreaId: technicalPackage.productionAreaId, technicalPackageId: technicalPackage.id, version: (latestVersion?.version ?? 0) + 1, releasedBy: employee.id } });
      for (const line of lines) {
        await tx.materialLine.create({ data: {
          materialVersionId: materialVersion.id, sourceFileName: line.sourceFileName, sourceSheet: line.sourceSheet, sourceRow: line.sourceRow, sourceSubRow: line.sourceSubRow,
          templateType: line.templateType, parserVersion: line.parserVersion, rawName: line.rawName, rawSpecification: line.rawSpecification, rawUnit: line.rawUnit,
          rawActualValue: line.rawActualValue, rawPurchaseValue: line.rawPurchaseValue, normalizedName: line.normalizedName, specification: line.specification, unit: line.unit,
          category: line.category, actualQty: line.actualQty, lossRate: line.lossRate, purchaseQty: line.purchaseQty, calculationSource: line.calculationSource,
          inventoryMode: line.inventoryMode, readinessClass: line.readinessClass, needsManualReview: line.needsManualReview, manualReason: line.manualReason,
          correctedBy: line.needsManualReview ? technicalPackage.submittedBy : null, correctedAt: line.needsManualReview ? new Date() : null,
        } });
      }
      const publishedLines = await tx.materialLine.findMany({ where: { materialVersionId: materialVersion.id } });
      await this.costs.createForMaterialVersion(tx, orderId, technicalPackage.productionAreaId, materialVersion.id, publishedLines);
      await this.costs.createWorkshopForTechnicalPackage(tx, orderId, technicalPackage.productionAreaId, technicalPackage);
      await tx.technicalPackageVersion.update({ where: { id: technicalPackage.id }, data: { status: "APPROVED", reviewedBy: employee.id, reviewComment: input.comment, reviewedAt: new Date() } });
      await tx.materialImportBatch.updateMany({ where: { technicalPackageId: technicalPackage.id }, data: { status: "PUBLISHED" } });
      await tx.productionArea.update({ where: { id: technicalPackage.productionAreaId }, data: { status: "TECHNICAL_APPROVED" } });
      materialVersions.push(materialVersion);
    }
    const startedAt = new Date();
    const dueAt = addInternalWorkingDays(startedAt, 15);
    const routeKinds: ProductionRouteKind[] = [
      ...(submissionSet.packages.some((item) => item.panelEnabled) ? ["PANEL" as const] : []),
      ...(submissionSet.packages.some((item) => item.woodPaintEnabled) ? ["WOOD_PAINT" as const] : []),
    ];
    const gates = new Map<ProductionRouteKind, { id: string }>();
    for (const kind of routeKinds) {
      const gate = await tx.procurementRouteGate.create({ data: { orderId, submissionSetId: submissionSet.id, kind, startedAt, dueAt } });
      gates.set(kind, gate);
    }
    for (const technicalPackage of submissionSet.packages) {
      if (!technicalPackage.productionAreaId) throw new BadRequestException("技术包缺少生产区域归属");
      const routePlans: Array<{ kind: ProductionRouteKind; assemblyPlanQty: number; workshops: Array<keyof typeof WORKSHOP_PROCESS_TEMPLATES>; quantities: Record<string, number> }> = [];
      if (technicalPackage.panelEnabled) {
        const assemblyPlanQty = Number(technicalPackage.panelAssemblyPlanQty);
        if (!Number.isFinite(assemblyPlanQty) || assemblyPlanQty <= 0) throw new BadRequestException(`${technicalPackage.productionArea?.name ?? "生产区域"}的板式路线组装面积尚未核定`);
        routePlans.push({ kind: "PANEL", assemblyPlanQty, workshops: ["PANEL", "ASSEMBLY"], quantities: { PANEL: Number(technicalPackage.panelPlanQty), ASSEMBLY: assemblyPlanQty } });
      }
      if (technicalPackage.woodPaintEnabled) {
        const assemblyPlanQty = Number(technicalPackage.woodPaintAssemblyPlanQty);
        if (!Number.isFinite(assemblyPlanQty) || assemblyPlanQty <= 0) throw new BadRequestException(`${technicalPackage.productionArea?.name ?? "生产区域"}的实木油漆路线组装面积尚未核定`);
        routePlans.push({ kind: "WOOD_PAINT", assemblyPlanQty, workshops: ["WOOD", "PAINT", "ASSEMBLY"], quantities: { WOOD: Number(technicalPackage.woodPlanQty), PAINT: Number(technicalPackage.paintPlanQty), ASSEMBLY: assemblyPlanQty } });
      }
      for (const routePlan of routePlans) {
        const gate = gates.get(routePlan.kind);
        if (!gate) throw new BadRequestException(`${PRODUCTION_ROUTE_LABELS[routePlan.kind]}采购门禁缺失`);
        const route = await tx.productionRoute.create({ data: { orderId, productionAreaId: technicalPackage.productionAreaId, technicalPackageId: technicalPackage.id, procurementRouteGateId: gate.id, kind: routePlan.kind, assemblyPlanQty: routePlan.assemblyPlanQty } });
        for (const workshop of routePlan.workshops) {
          const steps = workshop === "WOOD" && !technicalPackage.veneerRequired
            ? WORKSHOP_PROCESS_TEMPLATES.WOOD.filter((_, index) => index !== 2)
            : WORKSHOP_PROCESS_TEMPLATES[workshop];
          await tx.productionProcess.createMany({ data: steps.map((processName, index) => {
            const templateIndex = workshop === "WOOD"
              ? WORKSHOP_PROCESS_TEMPLATES.WOOD.indexOf(processName as (typeof WORKSHOP_PROCESS_TEMPLATES.WOOD)[number])
              : index;
            const assemblyMode = workshop === "ASSEMBLY" && index > 0;
            return {
              orderId,
              productionAreaId: technicalPackage.productionAreaId,
              productionRouteId: route.id,
              workshop,
              workshopLabel: workshop === "ASSEMBLY" ? `${PRODUCTION_ROUTE_LABELS[routePlan.kind]}组装` : WORKSHOP_LABELS[workshop],
              processCode: `${workshop}-${String(templateIndex + 1).padStart(2, "0")}`,
              processName,
              sequence: templateIndex + 1,
              plannedQty: assemblyMode ? 1 : routePlan.quantities[workshop],
              unit: assemblyMode ? "项" : "㎡",
              metricMode: workshop !== "ASSEMBLY" || index === 0 ? "AREA_QUANTITY" : index === 1 ? "REFERENCE_CONFIRMATION" : index === 2 ? "PACKAGE_COUNT" : "MILESTONE",
            };
          }) });
        }
      }
    }
    await tx.order.update({ where: { id: orderId }, data: { productionExecutionMode: "ROUTE_V2", procurementStartedAt: startedAt, procurementDueAt: dueAt, procurementCompletedAt: null, procurementCompletedBy: null, procurementDelayDays: 0, procurementPlanned: true, productionReady: false, materialSubstatus: "路线采购进行中", currentOwnerLabel: "采购部", nextAction: "分别确认板式路线与实木油漆路线采购" } });
    await this.outsource.approve(tx, orderId, submissionSet.id, employee, input.comment);
    await tx.technicalSubmissionSet.update({ where: { id: submissionSet.id }, data: { status: "APPROVED", reviewedBy: employee.id, reviewComment: input.comment, reviewedAt: new Date() } });
    return materialVersions;
  }

  async reject(tx: Tx, orderId: string, employee: Employee, reason: string) {
    this.requireReviewer(employee);
    const submissionSet = await tx.technicalSubmissionSet.findFirst({ where: { orderId, status: "SUBMITTED" }, include: { packages: true }, orderBy: { version: "desc" } });
    if (!submissionSet?.packages.length) throw new NotFoundException("没有可退回的整单技术提交集合");
    if (submissionSet.packages.some((technicalPackage) => technicalPackage.submittedBy === employee.id)) throw new ForbiddenException("拆单提交人与技术审单的订单管理员必须是不同员工");
    const now = new Date();
    await this.outsource.reject(tx, orderId, submissionSet.id, employee, reason);
    await tx.technicalPackageVersion.updateMany({ where: { submissionSetId: submissionSet.id }, data: { status: "REJECTED", reviewedBy: employee.id, reviewComment: reason, reviewedAt: now } });
    await tx.productionArea.updateMany({ where: { orderId, cancelledAt: null }, data: { status: "TECHNICAL_REJECTED" } });
    return tx.technicalSubmissionSet.update({ where: { id: submissionSet.id }, data: { status: "REJECTED", reviewedBy: employee.id, reviewComment: reason, reviewedAt: now } });
  }

  async detail(orderId: string) {
    return this.prisma.technicalPackageVersion.findFirst({
      where: { orderId },
      include: { materialImports: true, materialVersion: { include: { lines: { include: { item: true }, orderBy: [{ templateType: "asc" }, { sourceRow: "asc" }, { sourceSubRow: "asc" }] } } } },
      orderBy: { version: "desc" },
    });
  }

  async details(orderId: string) {
    return this.prisma.productionArea.findMany({
      where: { orderId },
      include: {
        technicalPackages: { include: { materialImports: true, materialVersion: { include: { lines: { include: { item: true }, orderBy: [{ templateType: "asc" }, { sourceRow: "asc" }, { sourceSubRow: "asc" }] } } } }, orderBy: { version: "desc" }, take: 1 },
      },
      orderBy: { sequence: "asc" },
    });
  }

  async reviewQueue() {
    return this.prisma.technicalSubmissionSet.findMany({
      where: { status: "SUBMITTED" },
      include: {
        order: { select: { id: true, trackingSerial: true, salesNumber: true, customerName: true, rush: true, internalDueAt: true } },
        packages: { include: { productionArea: true, materialImports: true } },
        outsourceRequirementVersion: { include: { lines: { orderBy: { sequence: "asc" } } } },
      },
      orderBy: { submittedAt: "asc" },
    });
  }

  private requireSplitter(employee: Employee) {
    if (!["TECHNICAL", "CHAIRMAN"].includes(employee.role)) throw new ForbiddenException("只有技术拆单员可以提交三件套");
  }

  private requireReviewer(employee: Employee) {
    if (!["ORDER_ADMIN", "CHAIRMAN"].includes(employee.role)) throw new ForbiddenException("只有订单管理员可以完成技术审单");
  }

  private previewResponse(batch: { id: string; templateType: MaterialTemplateType; parserVersion: string; fingerprintVersion: string; sourceProductionNumber: string | null; valid: boolean; sourceAttachmentId: string; fileName: string; sheetName: string; normalizedRows: Prisma.JsonValue; errors: Prisma.JsonValue; createdAt: Date }) {
    return {
      id: batch.id, templateType: batch.templateType, parserVersion: batch.parserVersion, fingerprintVersion: batch.fingerprintVersion,
      sourceProductionNumber: batch.sourceProductionNumber, valid: batch.valid, sourceAttachmentId: batch.sourceAttachmentId,
      fileName: batch.fileName, sheetName: batch.sheetName,
      lines: Array.isArray(batch.normalizedRows) ? batch.normalizedRows : [], errors: Array.isArray(batch.errors) ? batch.errors : [], createdAt: batch.createdAt,
    };
  }
}

function supportingAttachments(value: unknown, label: string) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new BadRequestException(`${label}文件无效`);
  const ids = value as string[];
  if (new Set(ids).size !== ids.length) throw new BadRequestException(`${label}不能包含重复文件`);
  return ids;
}

function oneAttachmentOptional(value: unknown, label: string) {
  const ids = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
  if (ids.length > 1) throw new BadRequestException(`${label}最多上传一个文件`);
  return ids[0] ?? "";
}

function coerceLines(value: unknown): ImportedMaterialLine[] {
  if (!Array.isArray(value)) throw new BadRequestException("物料明细格式无效");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new BadRequestException(`第${index + 1}条物料明细格式无效`);
    const line = entry as Record<string, unknown>;
    const actualQty = Number(line.actualQty);
    const purchaseQty = Number(line.purchaseQty);
    return {
      sourceFileName: String(line.sourceFileName ?? ""),
      sourceSheet: String(line.sourceSheet ?? ""),
      sourceRow: Number(line.sourceRow ?? index + 1),
      sourceSubRow: String(line.sourceSubRow ?? "A"),
      templateType: ["HARDWARE_MATERIALS", "PAINT_WOOD", "SOLID_WOOD_DOOR", "VENEER_DOOR"].includes(String(line.templateType)) ? line.templateType as MaterialTemplateType : "HARDWARE_MATERIALS",
      parserVersion: String(line.parserVersion ?? "V2.0"),
      rawName: String(line.rawName ?? line.normalizedName ?? ""),
      rawSpecification: line.rawSpecification == null ? null : String(line.rawSpecification),
      rawUnit: line.rawUnit == null ? null : String(line.rawUnit),
      rawActualValue: line.rawActualValue == null ? null : String(line.rawActualValue),
      rawPurchaseValue: line.rawPurchaseValue == null ? null : String(line.rawPurchaseValue),
      normalizedName: String(line.normalizedName ?? line.rawName ?? "").trim(),
      specification: line.specification == null || String(line.specification).trim() === "" ? null : String(line.specification).trim(),
      unit: String(line.unit ?? "未识别").trim(),
      category: String(line.category ?? "GENERAL"),
      actualQty,
      lossRate: line.lossRate == null ? null : Number(line.lossRate),
      purchaseQty,
      calculationSource: ["CALCULATED", "SOURCE_VALUE", "MANUAL_REQUIRED"].includes(String(line.calculationSource)) ? line.calculationSource as ImportedMaterialLine["calculationSource"] : "MANUAL_REQUIRED",
      inventoryMode: line.inventoryMode === "STOCK_STANDARD" ? "STOCK_STANDARD" : "ORDER_SPECIFIC",
      readinessClass: line.readinessClass === "DELIVERY_READINESS" ? "DELIVERY_READINESS" : "PRODUCTION_REQUIRED",
      needsManualReview: Boolean(line.needsManualReview),
      manualReason: line.manualReason == null ? null : String(line.manualReason).trim(),
    };
  });
}

function positivePlan(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new BadRequestException(`${label}车间计划面积必须大于0`);
  return number;
}

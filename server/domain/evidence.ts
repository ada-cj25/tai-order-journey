import { BadRequestException } from "@nestjs/common";
import type { OrderCommandType } from "./types.js";

const REQUIRED_EVIDENCE: Partial<Record<OrderCommandType, string[]>> = {
  REPORT_DEPOSIT: ["receivedAmount", "receivedAt", "account", "receiptAttachmentIds"],
  CONFIRM_DEPOSIT: ["verified"],
  REPORT_PREPAYMENT: ["receivedAmount", "receivedAt", "account", "receiptAttachmentIds"],
  CONFIRM_INITIAL_PAYMENTS: ["depositVerified", "prepaymentVerified"],
  ACCEPT_DESIGN: ["designLeadDays", "scopeConfirmed"],
  RETURN_DESIGN: ["reason"],
  ASSIGN_DESIGNER: ["designerId"],
  TRANSFER_DESIGN: ["designerId", "reason"],
  SUBMIT_DESIGN: ["designVersion", "surveyedAt", "customerConfirmedAt", "cadAttachmentIds", "confirmationAttachmentIds"],
  APPROVE_PRE_REVIEW: ["checklist"],
  REJECT_PRE_REVIEW: ["reason"],
  SUBMIT_TECHNICAL: ["productionAreaId", "designVersion", "rowCount", "materialImportIds", "materialLines"],
  APPROVE_TECH_REVIEW: ["checklist"],
  REJECT_TECH_REVIEW: ["reason"],
  PLAN_PROCUREMENT: ["materialLines"],
  START_PRODUCTION: ["planVersion", "panelQty", "woodQty", "paintQty", "assemblyQty", "checklist"],
  REPORT_TAIL_PAYMENT: ["receivedAmount", "receivedAt", "account", "receiptAttachmentIds"],
  CONFIRM_TAIL_PAYMENT: ["verified"],
  RECORD_DELIVERY: ["vehicle"],
  RECORD_OUTSOURCE_DELIVERY: ["lineIds", "vehicle"],
  COMPLETE_INSTALLATION: ["installedAt", "installer", "photoAttachmentIds"],
  ACCEPT_CUSTOMER: ["acceptedAt", "acceptanceAttachmentIds", "customerConclusion"],
};

const CHECKLIST_MINIMUMS: Partial<Record<OrderCommandType, number>> = {
  APPROVE_PRE_REVIEW: 6,
  APPROVE_TECH_REVIEW: 5,
  START_PRODUCTION: 4,
};

const FIELD_LABELS: Record<string, string> = {
  receivedAmount: "到账金额",
  receivedAt: "到账日期",
  account: "收款账户",
  receiptAttachmentIds: "到账凭证",
  verified: "财务到账核验",
  depositVerified: "定金到账核验",
  prepaymentVerified: "预付款到账核验",
  designLeadDays: "设计承诺天数",
  scopeConfirmed: "下单范围确认",
  reason: "原因说明",
  designerId: "目标设计师",
  designVersion: "设计版本",
  productionAreaId: "生产区域",
  surveyedAt: "复尺日期",
  customerConfirmedAt: "客户确认日期",
  spaces: "空间清单",
  materials: "材料与工艺说明",
  cadAttachmentIds: "CAD设计图",
  confirmationAttachmentIds: "客户确认图",
  sampleBlockAttachmentIds: "客户样块",
  checklist: "逐项检查表",
  haixunVersion: "海迅版本",
  rowCount: "导出明细行数",
  haixunAttachmentIds: "海迅单",
  decompositionAttachmentIds: "分解单",
  hardwareMaterialAttachmentIds: "五金物料表",
  paintWoodAttachmentIds: "油漆门板/实木分解表",
  solidWoodDoorAttachmentIds: "实木房门分解表",
  veneerDoorAttachmentIds: "饰面板房门分解表",
  materialImportIds: "物料导入预览",
  validationSummary: "校验结果摘要",
  materialLines: "采购物料明细",
  planVersion: "生产计划版本",
  panelQty: "板式计划面积",
  woodQty: "木工计划面积",
  paintQty: "油漆计划面积",
  assemblyQty: "组装计划面积",
  panelAssemblyQty: "板式路线组装计划面积",
  woodPaintAssemblyQty: "实木油漆路线组装计划面积",
  areaLines: "本次发货区域明细",
  outsourceLineIds: "本次外购产品",
  lineIds: "本次外购产品",
  installationDepartment: "安装班组",
  assignedInstallerId: "安装负责人",
  installationTeamLabel: "安装班组",
  contact: "现场联系人",
  plannedAt: "计划安装时间",
  pieceCount: "件数",
  supplyChecks: "安装资料与现场条件",
  productionNumber: "生产编号",
  deliveryNo: "发货单号",
  vehicle: "车辆与司机",
  installedAt: "安装完成时间",
  installer: "安装负责人",
  photoAttachmentIds: "安装完成照片",
  issueConclusion: "遗留问题结论",
  acceptedAt: "客户验收时间",
  acceptanceAttachmentIds: "客户验收签字",
  customerConclusion: "客户验收结论",
};

function hasValue(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return value !== undefined && value !== null && value !== false;
}

const TECHNICAL_SUPPORTING_FIELDS = ["haixunAttachmentIds", "decompositionAttachmentIds"] as const;

export function inheritTechnicalSupportingFiles(payload: Record<string, unknown>, sources: Array<Record<string, unknown> | null | undefined>) {
  const result = { ...payload };
  for (const field of TECHNICAL_SUPPORTING_FIELDS) {
    const ownIds = Array.isArray(result[field]) ? result[field] as unknown[] : [];
    if (ownIds.length) continue;
    const sourceIds = sources
      .map((source) => Array.isArray(source?.[field]) ? source[field] as unknown[] : [])
      .find((ids) => ids.length > 0);
    if (sourceIds) result[field] = [...sourceIds];
  }
  return result;
}

export function validateEvidence(command: OrderCommandType, payload: Record<string, unknown>) {
  const missing = (REQUIRED_EVIDENCE[command] ?? []).filter((field) => !hasValue(payload[field]));
  if (missing.length) throw new BadRequestException(`请先完成该节点的必填资料：${missing.map((field) => FIELD_LABELS[field] ?? field).join("、")}`);
  if (command === "START_PRODUCTION" && ["panelQty", "woodQty", "paintQty", "assemblyQty"].some((field) => Number(payload[field]) <= 0)) {
    throw new BadRequestException("四个车间的计划面积必须大于0");
  }
  if (command === "SUBMIT_TECHNICAL") {
    const panelEnabled = payload.panelEnabled === true;
    const woodPaintEnabled = payload.woodPaintEnabled === true;
    if (!panelEnabled && !woodPaintEnabled) throw new BadRequestException("每个生产区域至少选择一条生产路线");
    const positive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0;
    const panelAssemblyValid = positive(payload.panelAssemblyQty) || (!woodPaintEnabled && positive(payload.assemblyQty));
    const woodAssemblyValid = positive(payload.woodPaintAssemblyQty) || (!panelEnabled && positive(payload.assemblyQty));
    if ((panelEnabled && (!positive(payload.panelQty) || !panelAssemblyValid))
      || (woodPaintEnabled && (!positive(payload.woodQty) || !positive(payload.paintQty) || !woodAssemblyValid))) {
      throw new BadRequestException("已选生产路线和组装车间的计划面积必须大于0");
    }
  }
  if (command === "SUBMIT_DESIGN" && Array.isArray(payload.sampleBlockAttachmentIds) && payload.sampleBlockAttachmentIds.length > 0 && !hasValue(payload.sampleBlockRemark)) {
    throw new BadRequestException("上传客户样块时必须填写共用的样块备注");
  }
  if (command === "RECORD_DELIVERY") {
    const lines = Array.isArray(payload.areaLines) ? payload.areaLines : [];
    const productionRouteBatches = Array.isArray(payload.productionRouteBatches) ? payload.productionRouteBatches : [];
    const productionRouteIds = productionRouteBatches.map((value) => value && typeof value === "object" ? String((value as Record<string, unknown>).productionRouteId ?? "") : "");
    const areaIds = lines.map((value) => value && typeof value === "object" ? String((value as Record<string, unknown>).productionAreaId ?? "") : "");
    const outsourceLineIds = Array.isArray(payload.outsourceLineIds) ? payload.outsourceLineIds.filter((id) => typeof id === "string" && id.trim()) : [];
    if (!lines.length && !productionRouteIds.length && !outsourceLineIds.length) throw new BadRequestException("请至少选择一条可发产品路线或已齐套外购产品");
    if (areaIds.some((id) => !id) || new Set(areaIds).size !== areaIds.length) throw new BadRequestException("发货批次必须包含不重复的有效生产区域明细");
    if (productionRouteIds.some((id) => !id) || new Set(productionRouteIds).size !== productionRouteIds.length) throw new BadRequestException("请选择不重复的可发产品路线");
    if (new Set(outsourceLineIds).size !== outsourceLineIds.length) throw new BadRequestException("请选择不重复的已齐套外购产品");
    if (lines.length || productionRouteIds.length) {
      const installationFields = ["assignedInstallerId", "installationTeamLabel", "contact", "plannedAt", "supplyChecks"];
      const installationMissing = installationFields.filter((field) => !hasValue(payload[field]));
      if (installationMissing.length) throw new BadRequestException(`自产发货请完整填写本车次安装安排：${installationMissing.map((field) => FIELD_LABELS[field] ?? field).join("、")}`);
      const plannedAt = String(payload.plannedAt ?? "");
      const parsed = new Date(`${plannedAt}T00:00:00+08:00`);
      const validDate = /^\d{4}-\d{2}-\d{2}$/.test(plannedAt) && !Number.isNaN(parsed.getTime())
        && new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed) === plannedAt;
      if (!validDate) throw new BadRequestException("计划安装日期无效");
    }
  }
  if (command === "RECORD_OUTSOURCE_DELIVERY") {
    const lineIds = Array.isArray(payload.lineIds) ? payload.lineIds.filter((id) => typeof id === "string" && id.trim()) : [];
    if (!lineIds.length || new Set(lineIds).size !== lineIds.length) throw new BadRequestException("请选择不重复的已齐套外购产品");
  }
  if (command === "SUBMIT_TECHNICAL") {
    const attachmentFields = ["hardwareMaterialAttachmentIds", "paintWoodAttachmentIds", "solidWoodDoorAttachmentIds", "veneerDoorAttachmentIds"];
    const counts = attachmentFields.map((field) => Array.isArray(payload[field]) ? (payload[field] as unknown[]).length : 0);
    if (counts.some((count) => count > 1) || counts.reduce((sum, count) => sum + count, 0) < 1) throw new BadRequestException("实际存在的物料Excel每类最多一份，且至少上传一类");
    const previews = Array.isArray(payload.materialImportIds) ? payload.materialImportIds : [];
    if (previews.length !== counts.reduce((sum, count) => sum + count, 0) || previews.length > 4) throw new BadRequestException("物料Excel与有效解析预览必须逐类对应");
  }
  if (command === "ACCEPT_DESIGN" && (!Number.isInteger(Number(payload.designLeadDays)) || Number(payload.designLeadDays) < 1 || Number(payload.designLeadDays) > 7)) {
    throw new BadRequestException("设计承诺天数必须在1至7个工作日之间");
  }
  if (["REPORT_DEPOSIT", "REPORT_PREPAYMENT", "REPORT_TAIL_PAYMENT"].includes(command)) {
    const receivedAmount = Number(payload.receivedAmount);
    if (!Number.isFinite(receivedAmount) || receivedAmount <= 0) throw new BadRequestException("到账金额必须大于0");
  }
  if (command === "PLAN_PROCUREMENT") {
    const lines = Array.isArray(payload.materialLines) ? payload.materialLines : [];
    if (!lines.length || lines.some((line) => !line || typeof line !== "object" || !String((line as Record<string, unknown>).name ?? "").trim() || Number((line as Record<string, unknown>).quantity) <= 0)) {
      throw new BadRequestException("采购明细必须填写物料名称和大于0的数量");
    }
  }
  if (command === "SUBMIT_TECHNICAL") {
    const supportingFields = ["haixunAttachmentIds", "decompositionAttachmentIds"];
    if (supportingFields.some((field) => {
      const value = payload[field];
      if (value === undefined || value === null) return false;
      if (!Array.isArray(value)) return true;
      const ids = value as unknown[];
      return ids.some((id) => typeof id !== "string" || !id.trim()) || new Set(ids).size !== ids.length;
    })) {
      throw new BadRequestException("可选的海迅单和分解单如有上传，必须为有效文件且不能包含重复文件");
    }
  }
  const minimum = CHECKLIST_MINIMUMS[command];
  if (minimum) {
    const checklist = Array.isArray(payload.checklist) ? payload.checklist : [];
    const passed = checklist.filter((item) => typeof item === "object" && item && (item as { checked?: boolean }).checked).length;
    if (checklist.length < minimum || passed !== checklist.length) throw new BadRequestException("所有审核项均需逐项勾选后才能通过");
  }
}

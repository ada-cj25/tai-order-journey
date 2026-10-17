import assert from "node:assert/strict";
import test from "node:test";
import { inheritTechnicalSupportingFiles, validateEvidence } from "./evidence.js";

test("区域提交可继承订单级海迅和分解文件", () => {
  const payload = inheritTechnicalSupportingFiles({ productionAreaId: "area-2" }, [
    { haixunAttachmentIds: ["haixun-1", "haixun-2"], decompositionAttachmentIds: ["decomposition-1"] },
  ]);
  assert.deepEqual(payload.haixunAttachmentIds, ["haixun-1", "haixun-2"]);
  assert.deepEqual(payload.decompositionAttachmentIds, ["decomposition-1"]);
});

test("workflow transitions reject blind confirmations", () => {
  assert.throws(() => validateEvidence("SUBMIT_DESIGN", {}), /必填资料/);
  assert.throws(() => validateEvidence("SUBMIT_TECHNICAL", { designVersion: "V1", rowCount: 88, validationSummary: "校验完成" }), /生产区域、物料导入预览、采购物料明细/);
  assert.throws(() => validateEvidence("REPORT_DEPOSIT", { receivedAmount: 1000, receivedAt: "2026-08-28", account: "公司基本户" }), /到账凭证/);
  assert.doesNotThrow(() => validateEvidence("REPORT_DEPOSIT", { receivedAmount: 1000, receivedAt: "2026-08-28", account: "董事长已批准账户", receiptAttachmentIds: ["receipt"] }));
  assert.doesNotThrow(() => validateEvidence("CONFIRM_DEPOSIT", { verified: true }));
  assert.throws(() => validateEvidence("CONFIRM_INITIAL_PAYMENTS", { depositVerified: true, prepaymentVerified: false }), /预付款到账核验/);
  assert.doesNotThrow(() => validateEvidence("CONFIRM_INITIAL_PAYMENTS", { depositVerified: true, prepaymentVerified: true }));
  assert.doesNotThrow(() => validateEvidence("REPORT_PREPAYMENT", { receivedAmount: 30000, receivedAt: "2026-08-28", account: "公司基本户", receiptAttachmentIds: ["receipt"] }));
  assert.throws(() => validateEvidence("REPORT_PREPAYMENT", { receivedAmount: 0, receivedAt: "2026-08-28", account: "公司基本户", receiptAttachmentIds: ["receipt"] }), /必须大于0/);
  assert.throws(() => validateEvidence("ACCEPT_DESIGN", { designLeadDays: 8, scopeConfirmed: true }), /1至7/);
});

test("design submission requires only core drawings while summaries and customer sample remain optional", () => {
  assert.doesNotThrow(() => validateEvidence("SUBMIT_DESIGN", { designVersion: "V1", surveyedAt: "2026-09-09", customerConfirmedAt: "2026-09-09", cadAttachmentIds: ["cad"], confirmationAttachmentIds: ["confirmation"] }));
  assert.throws(() => validateEvidence("SUBMIT_DESIGN", { designVersion: "V1", surveyedAt: "2026-09-09", customerConfirmedAt: "2026-09-09", sampleBlockAttachmentIds: ["sample"] }), /CAD设计图/);
  assert.throws(() => validateEvidence("SUBMIT_DESIGN", { designVersion: "V1", surveyedAt: "2026-09-09", customerConfirmedAt: "2026-09-09", cadAttachmentIds: ["cad"], confirmationAttachmentIds: ["confirmation"], sampleBlockAttachmentIds: ["sample-1", "sample-2"] }), /样块备注/);
  assert.doesNotThrow(() => validateEvidence("SUBMIT_DESIGN", { designVersion: "V1", surveyedAt: "2026-09-09", customerConfirmedAt: "2026-09-09", cadAttachmentIds: ["cad-1", "cad-2"], confirmationAttachmentIds: ["confirmation"], sampleBlockAttachmentIds: ["sample-1", "sample-2"], sampleBlockRemark: "客厅木色与主卧灰色样块，客户已核对" }));
});

test("设计退回、重新分配与转交要求各自的业务证据", () => {
  assert.throws(() => validateEvidence("RETURN_DESIGN", {}), /原因说明/);
  assert.doesNotThrow(() => validateEvidence("RETURN_DESIGN", { reason: "排期冲突" }));
  assert.throws(() => validateEvidence("ASSIGN_DESIGNER", {}), /目标设计师/);
  assert.doesNotThrow(() => validateEvidence("ASSIGN_DESIGNER", { designerId: "designer-2" }));
  assert.throws(() => validateEvidence("TRANSFER_DESIGN", { designerId: "designer-2" }), /原因说明/);
  assert.doesNotThrow(() => validateEvidence("TRANSFER_DESIGN", { designerId: "designer-2", reason: "项目交接" }));
});

test("reviews require every checklist item to pass", () => {
  const checklist = ["范围", "CAD", "材料", "外购", "客户确认", "交期"].map((label) => ({ label, checked: true }));
  assert.doesNotThrow(() => validateEvidence("APPROVE_PRE_REVIEW", { checklist }));
  assert.throws(() => validateEvidence("APPROVE_PRE_REVIEW", { checklist: checklist.map((item, index) => index === 2 ? { ...item, checked: false } : item) }), /逐项勾选/);
});

test("technical delivery accepts one to four distinct material previews and requires workshop plans", () => {
  assert.doesNotThrow(() => validateEvidence("SUBMIT_TECHNICAL", {
    productionAreaId: "area-with-optional-supporting-files", panelEnabled: true, woodPaintEnabled: false,
    designVersion: "V1", rowCount: 1,
    hardwareMaterialAttachmentIds: ["hardware-id"], materialImportIds: ["import-1"], materialLines: [{}],
    panelQty: 1, panelAssemblyQty: 1,
  }));
  assert.doesNotThrow(() => validateEvidence("SUBMIT_TECHNICAL", {
    productionAreaId: "area-1", panelEnabled: true, woodPaintEnabled: true,
    designVersion: "V1",
    rowCount: 128,
    haixunAttachmentIds: ["haixun-id"],
    decompositionAttachmentIds: ["decomposition-id"],
    hardwareMaterialAttachmentIds: ["hardware-id"],
    paintWoodAttachmentIds: ["paint-wood-id"],
    solidWoodDoorAttachmentIds: ["solid-door-id"],
    veneerDoorAttachmentIds: ["veneer-door-id"],
    materialImportIds: ["import-1", "import-2", "import-3", "import-4"],
    materialLines: [{ normalizedName: "柜身厚板", actualQty: 85, purchaseQty: 100, unit: "㎡" }],
    validationSummary: "柜体、门板、五金和台面字段完整",
    panelQty: 398, woodQty: 24, paintQty: 12, panelAssemblyQty: 18, woodPaintAssemblyQty: 8,
  }));
  assert.doesNotThrow(() => validateEvidence("SUBMIT_TECHNICAL", {
    productionAreaId: "area-without-summary", panelEnabled: true, woodPaintEnabled: false, designVersion: "V1", rowCount: 1,
    haixunAttachmentIds: ["haixun-id"], decompositionAttachmentIds: ["decomposition-id"],
    hardwareMaterialAttachmentIds: ["hardware-id"], materialImportIds: ["import-1"], materialLines: [{}], panelQty: 1, panelAssemblyQty: 1,
  }));
  assert.doesNotThrow(() => validateEvidence("SUBMIT_TECHNICAL", {
    productionAreaId: "area-1", panelEnabled: true, woodPaintEnabled: true, designVersion: "V1", rowCount: 1, haixunAttachmentIds: ["a", "b"], decompositionAttachmentIds: ["c"], hardwareMaterialAttachmentIds: ["d"], paintWoodAttachmentIds: ["e"], solidWoodDoorAttachmentIds: ["f"], veneerDoorAttachmentIds: ["g"], materialImportIds: ["i1", "i2", "i3", "i4"], materialLines: [{}], validationSummary: "已检查", panelQty: 1, woodQty: 1, paintQty: 1, panelAssemblyQty: 1, woodPaintAssemblyQty: 1,
  }));
  assert.throws(() => validateEvidence("SUBMIT_TECHNICAL", {
    productionAreaId: "area-duplicate", panelEnabled: true, woodPaintEnabled: false, designVersion: "V1", rowCount: 1, haixunAttachmentIds: ["a", "a"], decompositionAttachmentIds: ["b"], hardwareMaterialAttachmentIds: ["c"], materialImportIds: ["i"], materialLines: [{}], panelQty: 1, panelAssemblyQty: 1,
  }), /不能包含重复文件/);
  assert.doesNotThrow(() => validateEvidence("SUBMIT_TECHNICAL", {
    productionAreaId: "area-2", panelEnabled: true, woodPaintEnabled: false, designVersion: "V1", rowCount: 1,
    haixunAttachmentIds: ["haixun-id"], decompositionAttachmentIds: ["decomposition-id"],
    hardwareMaterialAttachmentIds: ["hardware-id"], materialImportIds: ["import-1"],
    materialLines: [{ normalizedName: "柜身厚板", actualQty: 85, purchaseQty: 100, unit: "㎡" }],
    validationSummary: "仅有五金物料表，解析有效", panelQty: 1, assemblyQty: 1,
  }));
  assert.doesNotThrow(() => validateEvidence("SUBMIT_TECHNICAL", {
    productionAreaId: "area-3", panelEnabled: false, woodPaintEnabled: true, designVersion: "V1", rowCount: 1,
    haixunAttachmentIds: ["haixun-id"], decompositionAttachmentIds: ["decomposition-id"], hardwareMaterialAttachmentIds: ["hardware-id"], materialImportIds: ["import-1"],
    materialLines: [{}], validationSummary: "木工油漆路线", woodQty: 1, paintQty: 1, assemblyQty: 1,
  }));
  assert.throws(() => validateEvidence("SUBMIT_TECHNICAL", {
    productionAreaId: "area-4", panelEnabled: false, woodPaintEnabled: false, designVersion: "V1", rowCount: 1,
    haixunAttachmentIds: ["a"], decompositionAttachmentIds: ["b"], hardwareMaterialAttachmentIds: ["c"], materialImportIds: ["i"], materialLines: [{}], validationSummary: "无路线", assemblyQty: 1,
  }), /至少选择一条生产路线/);
});

test("production release requires quantities while later reporting may remain partial", () => {
  const checklist = ["板式", "木工", "油漆", "组装"].map((label) => ({ label, checked: true }));
  assert.throws(() => validateEvidence("START_PRODUCTION", { planVersion: "P1", checklist }), /计划面积/);
  assert.doesNotThrow(() => validateEvidence("START_PRODUCTION", { planVersion: "P1", panelQty: 398, woodQty: 24, paintQty: 12, assemblyQty: 26, checklist }));
});

test("one shipment registration accepts manufactured batches, ready outsourced products, or both", () => {
  const installationArrangement = { assignedInstallerId: "installer-1", installationTeamLabel: "安装一组", installationDepartment: "安装一组", contact: "张师傅 13800000000", plannedAt: "2026-09-20", supplyChecks: "水电已完成，可进场" };
  assert.doesNotThrow(() => validateEvidence("RECORD_DELIVERY", {
    areaLines: [
      { productionAreaId: "area-1", isFinalBatch: false },
      { productionAreaId: "area-2", isFinalBatch: true },
    ],
    vehicle: "沪A12345 / 张师傅",
    installationFees: { "area-1": 100, "area-2": 200 },
    ...installationArrangement,
  }));
  assert.doesNotThrow(() => validateEvidence("RECORD_DELIVERY", {
    areaLines: [], outsourceLineIds: ["outsource-1"], vehicle: "沪a12345 / 张师傅",
  }));
  assert.doesNotThrow(() => validateEvidence("RECORD_DELIVERY", {
    productionRouteBatches: [{ productionRouteId: "route-panel", isFinalBatch: false }, { productionRouteId: "route-wood", isFinalBatch: true }], outsourceLineIds: [], vehicle: "沪a12345 / 张师傅", installationFees: { "area-1": 100 },
    ...installationArrangement,
  }));
  assert.doesNotThrow(() => validateEvidence("RECORD_DELIVERY", {
    areaLines: [{ productionAreaId: "area-1", isFinalBatch: true }],
    outsourceLineIds: ["outsource-1"], vehicle: "沪a12345 / 张师傅", installationFees: { "area-1": 100 },
    ...installationArrangement,
  }));
  assert.throws(() => validateEvidence("RECORD_DELIVERY", { areaLines: [], outsourceLineIds: [] }), /车辆与司机/);
  assert.throws(() => validateEvidence("RECORD_DELIVERY", { vehicle: "沪a12345", areaLines: [], outsourceLineIds: [] }), /至少选择/);
  assert.throws(() => validateEvidence("RECORD_DELIVERY", {
    areaLines: [
      { productionAreaId: "area-1", isFinalBatch: false },
      { productionAreaId: "area-1", isFinalBatch: true },
    ],
    vehicle: "沪A12345",
  }), /不重复/);
  assert.throws(() => validateEvidence("RECORD_DELIVERY", {
    areaLines: [], outsourceLineIds: ["outsource-1", "outsource-1"], vehicle: "沪a12345",
  }), /不重复/);
  assert.throws(() => validateEvidence("RECORD_DELIVERY", {
    productionRouteBatches: [{ productionRouteId: "route-panel", isFinalBatch: false }, { productionRouteId: "route-panel", isFinalBatch: true }], vehicle: "沪a12345",
  }), /不重复/);
});

test("自产发货必须填写本车次安装安排，纯外购发货不需要", () => {
  assert.throws(() => validateEvidence("RECORD_DELIVERY", {
    productionRouteBatches: [{ productionRouteId: "route-panel", isFinalBatch: false }], vehicle: "沪a12345 / 张师傅",
  }), /本车次安装安排/);
  assert.throws(() => validateEvidence("RECORD_DELIVERY", {
    productionRouteBatches: [{ productionRouteId: "route-panel", isFinalBatch: false }], vehicle: "沪a12345 / 张师傅",
    assignedInstallerId: "installer-1", installationTeamLabel: "安装一组", installationDepartment: "安装一组", contact: "张师傅", plannedAt: "2026-02-30", supplyChecks: "可进场",
  }), /日期无效/);
  assert.doesNotThrow(() => validateEvidence("RECORD_DELIVERY", {
    areaLines: [], outsourceLineIds: ["outsource-1"], vehicle: "沪a12345 / 张师傅",
  }));
});

test("安装完成允许没有遗留问题结论，但仍要求负责人和完成照片", () => {
  assert.doesNotThrow(() => validateEvidence("COMPLETE_INSTALLATION", {
    installedAt: "2026-09-10",
    installer: "安装一组",
    photoAttachmentIds: ["installation-photo"],
  }));
  assert.throws(() => validateEvidence("COMPLETE_INSTALLATION", {
    installedAt: "2026-09-10",
    installer: "安装一组",
  }), /安装完成照片/);
});

test("outsourced delivery selects one or more unique ready product lines", () => {
  assert.doesNotThrow(() => validateEvidence("RECORD_OUTSOURCE_DELIVERY", { lineIds: ["line-1", "line-2"], vehicle: "沪A12345 / 张师傅" }));
  assert.throws(() => validateEvidence("RECORD_OUTSOURCE_DELIVERY", { lineIds: [], vehicle: "沪A12345" }), /外购产品/);
  assert.throws(() => validateEvidence("RECORD_OUTSOURCE_DELIVERY", { lineIds: ["line-1", "line-1"], vehicle: "沪A12345" }), /不重复/);
});

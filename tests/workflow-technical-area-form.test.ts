import assert from "node:assert/strict";
import test from "node:test";
import { hasCompleteTechnicalAreaRequiredFields, hasCompleteTechnicalAreaSubmission, inheritTechnicalSupportingFiles, projectTechnicalAreaPlan, technicalAreaSubmissionGaps } from "../src/technical-area-form.js";

test("technical area required fields do not include the optional validation summary", () => {
  assert.equal(hasCompleteTechnicalAreaRequiredFields({ designVersion: "V1", panelEnabled: true, woodPaintEnabled: false, panelQty: 1, assemblyQty: 1 }), true);
});

test("technical area required fields follow the selected production routes", () => {
  assert.equal(hasCompleteTechnicalAreaRequiredFields({ designVersion: "V1", panelEnabled: true, woodPaintEnabled: false, assemblyQty: 1 }), false);
  assert.equal(hasCompleteTechnicalAreaRequiredFields({ designVersion: "V1", panelEnabled: false, woodPaintEnabled: true, woodQty: 1, paintQty: 1, assemblyQty: 1 }), true);
  assert.equal(hasCompleteTechnicalAreaRequiredFields({ designVersion: "V1", panelEnabled: false, woodPaintEnabled: true, woodQty: 1, assemblyQty: 1 }), false);
  assert.equal(hasCompleteTechnicalAreaRequiredFields({ designVersion: "V1", panelEnabled: false, woodPaintEnabled: false, assemblyQty: 1 }), false);
});

test("an autosaved area plan is projected back onto the order-area card before formal package submission", () => {
  const projection = projectTechnicalAreaPlan(
    { id: "dance", route: null, technicalPackage: null },
    [
      {
        command: "SUBMIT_TECHNICAL",
        status: "DRAFT",
        payload: {
          productionAreaId: "dance",
          designVersion: "V1",
          panelEnabled: true,
          woodPaintEnabled: false,
          panelQty: 15,
          assemblyQty: 15,
        },
      },
    ],
  );

  assert.deepEqual(projection.route, { panelEnabled: true, woodPaintEnabled: false });
  assert.equal(projection.status, "DRAFT_COMPLETE");
  assert.equal(projection.label, "计划已保存 · 待提交资料");
});

test("a complete technical area draft can join a one-or-many batch submission", () => {
  const payload = {
    productionAreaId: "bedroom",
    designVersion: "V1",
    panelEnabled: true,
    woodPaintEnabled: false,
    panelQty: 15,
    panelAssemblyQty: 15,
    haixunAttachmentIds: ["haixun-1"],
    decompositionAttachmentIds: ["decomposition-1"],
    materialImportIds: ["import-1"],
    materialLines: [{ normalizedName: "柜体板" }],
    rowCount: 1,
  };
  assert.equal(hasCompleteTechnicalAreaSubmission(payload), true);
  assert.equal(hasCompleteTechnicalAreaSubmission({ ...payload, haixunAttachmentIds: [], decompositionAttachmentIds: [] }), true);
  assert.equal(hasCompleteTechnicalAreaSubmission({
    ...payload,
    haixunAttachmentIds: undefined,
    decompositionAttachmentIds: undefined,
  }), true);

  const projection = projectTechnicalAreaPlan(
    { id: "bedroom", route: null, technicalPackage: null },
    [{ command: "SUBMIT_TECHNICAL", status: "DRAFT", payload }],
  );
  assert.equal(projection.status, "DRAFT_READY");
  assert.equal(projection.label, "区域资料已就绪 · 可批量提交");
});

test("只填完路线面积的区域只列出必需的物料解析", () => {
  const gaps = technicalAreaSubmissionGaps({
    productionAreaId: "child-room",
    designVersion: "V1",
    panelEnabled: true,
    woodPaintEnabled: true,
    panelQty: 22,
    panelAssemblyQty: 11,
    woodQty: 111,
    paintQty: 22,
    woodPaintAssemblyQty: 22,
  });
  assert.deepEqual(gaps, ["物料解析"]);
});

test("订单级海迅和分解文件可由多个区域草稿共同引用", () => {
  const areaPayload = {
    productionAreaId: "child-room",
    designVersion: "V1",
    panelEnabled: true,
    woodPaintEnabled: false,
    panelQty: 22,
    panelAssemblyQty: 11,
    materialImportIds: ["import-1"],
    materialLines: [{ normalizedName: "柜身板" }],
    rowCount: 1,
  };
  const inherited = inheritTechnicalSupportingFiles(areaPayload, [
    { haixunAttachmentIds: ["haixun-1", "haixun-2"], decompositionAttachmentIds: ["decomposition-1"] },
  ]);
  assert.deepEqual(inherited.haixunAttachmentIds, ["haixun-1", "haixun-2"]);
  assert.deepEqual(inherited.decompositionAttachmentIds, ["decomposition-1"]);
  assert.equal(hasCompleteTechnicalAreaSubmission(inherited), true);
});

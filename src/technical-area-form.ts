export type TechnicalAreaFormValues = Record<string, unknown>;

const TECHNICAL_SUPPORTING_FIELDS = ["haixunAttachmentIds", "decompositionAttachmentIds"] as const;

type TechnicalAreaDraftSubmission = {
  command: string;
  status: string;
  payload: TechnicalAreaFormValues;
};

type TechnicalAreaPlanSource = {
  id: string;
  route?: { panelEnabled: boolean; woodPaintEnabled: boolean } | null;
  technicalPackage?: unknown | null;
};

function isPositiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

export function inheritTechnicalSupportingFiles(values: TechnicalAreaFormValues, sources: Array<TechnicalAreaFormValues | null | undefined>) {
  const result = { ...values };
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

export function hasCompleteTechnicalAreaRequiredFields(values: TechnicalAreaFormValues | undefined) {
  if (!values || !String(values.designVersion ?? "").trim()) return false;
  const panelEnabled = values.panelEnabled === true;
  const woodPaintEnabled = values.woodPaintEnabled === true;
  if (!panelEnabled && !woodPaintEnabled) return false;
  const panelAssemblyComplete = isPositiveNumber(values.panelAssemblyQty) || (!woodPaintEnabled && isPositiveNumber(values.assemblyQty));
  const woodPaintAssemblyComplete = isPositiveNumber(values.woodPaintAssemblyQty) || (!panelEnabled && isPositiveNumber(values.assemblyQty));
  if (panelEnabled && (!isPositiveNumber(values.panelQty) || !panelAssemblyComplete)) return false;
  if (woodPaintEnabled && (!isPositiveNumber(values.woodQty) || !isPositiveNumber(values.paintQty) || !woodPaintAssemblyComplete)) return false;
  return true;
}

export function hasCompleteTechnicalAreaSubmission(values: TechnicalAreaFormValues | undefined) {
  return technicalAreaSubmissionGaps(values).length === 0;
}

export function technicalAreaSubmissionGaps(values: TechnicalAreaFormValues | undefined) {
  const gaps: string[] = [];
  if (!hasCompleteTechnicalAreaRequiredFields(values)) gaps.push("路线生产计划");
  const materialImportIds = Array.isArray(values?.materialImportIds) ? values.materialImportIds : [];
  const materialLines = Array.isArray(values?.materialLines) ? values.materialLines : [];
  if (!(materialImportIds.length > 0 && materialLines.length > 0 && Number(values?.rowCount) > 0)) gaps.push("物料解析");
  return gaps;
}

export function projectTechnicalAreaPlan(area: TechnicalAreaPlanSource, submissions: TechnicalAreaDraftSubmission[] | undefined) {
  if (area.technicalPackage) return { route: area.route ?? null, status: "SUBMITTED" as const, label: "技术包已提交" };

  const draft = submissions?.find((submission) => (
    submission.command === "SUBMIT_TECHNICAL"
    && submission.status === "DRAFT"
    && String(submission.payload.productionAreaId ?? "") === area.id
  ));
  if (!draft) return { route: area.route ?? null, status: "EMPTY" as const, label: "待填写生产计划" };

  const panelEnabled = draft.payload.panelEnabled === true;
  const woodPaintEnabled = draft.payload.woodPaintEnabled === true;
  const route = panelEnabled || woodPaintEnabled ? { panelEnabled, woodPaintEnabled } : area.route ?? null;
  const ready = hasCompleteTechnicalAreaSubmission(draft.payload);
  const complete = hasCompleteTechnicalAreaRequiredFields(draft.payload);
  return {
    route,
    status: ready ? "DRAFT_READY" as const : complete ? "DRAFT_COMPLETE" as const : "DRAFT_INCOMPLETE" as const,
    label: ready ? "区域资料已就绪 · 可批量提交" : complete ? "计划已保存 · 待提交资料" : "计划草稿待补充",
  };
}

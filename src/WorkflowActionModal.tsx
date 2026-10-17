import { useEffect, useRef, useState } from "react";
import { Alert, App as AntApp, Button, Checkbox, DatePicker, Descriptions, Divider, Form, Input, InputNumber, Modal, Select, Space, Steps, Table, Tag, Upload } from "antd";
import zhCNDatePickerLocale from "antd/es/date-picker/locale/zh_CN";
import type { UploadFile } from "antd/es/upload/interface";
import { RiAttachment2, RiUpload2Line } from "@remixicon/react";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { hasCompleteTechnicalAreaRequiredFields, hasCompleteTechnicalAreaSubmission, inheritTechnicalSupportingFiles, technicalAreaSubmissionGaps } from "./technical-area-form";
import { collectPreservedFormValues } from "./workflow-form-values";

dayjs.locale("zh-cn");

export type WorkflowAction = { command: string; label: string; danger?: boolean; shipmentId?: string; productionAreaId?: string };
type MaterialPreviewLine = { sourceRow: number; sourceSubRow: string; templateType: string; parserVersion: string; sourceSheet: string; rawName: string; normalizedName: string; specification?: string | null; actualQty: number; purchaseQty: number; unit: string; calculationSource: string; inventoryMode: string; readinessClass: string; needsManualReview: boolean; manualReason?: string | null };
type StageSubmissionRef = { command: string; status: string; payload: Record<string, unknown> };
type OrderRef = {
  id: string;
  updatedAt?: string;
  trackingSerial: string;
  salesNumber?: string | null;
  productionNumber?: string | null;
  designer?: { id?: string; name: string } | null;
  productionExecutionMode?: "AREA_LEGACY" | "ROUTE_V2";
  shipmentGate?: { allowedProductionRouteIds?: string[] };
  productionAreas?: Array<{ id: string; name: string; productionNumber: string; status: string; shipped?: boolean; shipmentBatches?: Array<{ id: string }>; production?: { complete: boolean; percent: number }; routes?: Array<{ id: string; kind: "PANEL" | "WOOD_PAINT"; label: string; complete: boolean; shipped: boolean; percent: number; shipmentBatches?: Array<{ id: string; sequence: number; isFinalBatch: boolean }> }>; route?: { panelEnabled: boolean; woodPaintEnabled: boolean } | null; technicalPackage?: OrderRef["technicalPackage"] }>;
  stageSubmissions?: StageSubmissionRef[];
  attachments?: Array<{ id: string; originalName: string; category: string }>;
  technicalPackage?: { version: number; designVersion: string; status?: string; haixunAttachmentId: string | null; decompositionAttachmentId: string | null; haixunAttachmentIds?: string[]; decompositionAttachmentIds?: string[]; materialAttachmentId: string; validationSummary: string; rowCount: number; panelEnabled?: boolean; woodPaintEnabled?: boolean; veneerRequired?: boolean; panelPlanQty?: number; woodPlanQty?: number; paintPlanQty?: number; assemblyPlanQty?: number; panelAssemblyPlanQty?: number; woodPaintAssemblyPlanQty?: number; firstBatchInstallationFee?: number | null; materialImports?: Array<{ templateType: string; fileName: string; sheetName: string; errors?: unknown[]; normalizedRows?: MaterialPreviewLine[] }>; materialVersion?: { version: number; lines?: any[] } | null } | null;
  outsourceRequirement?: { declaresNone: boolean; status: string; lines: Array<{ id: string; name: string; plannedQty: number; unit: string; usageArea?: string | null }> } | null;
  fulfillmentTracks?: { outsourced: { lines: Array<{ id: string; name: string; plannedQty: number; unit: string; usageArea?: string | null; status: string; canShip: boolean }> } };
  packageSummary?: { currentTotal: number; status: string; hardwareTotal: number; manufacturedTotal: number; outsourcedTotal: number; pendingSources: Array<{ sourceKey: string; label: string }> };
  shipments?: Array<{ id: string; kind: string; deliveredAt: string; vehicle: string; pieceCount: number | null; installationDepartment?: string | null; installationTeamLabel?: string | null; assignedInstaller?: { id: string; name: string; department: string } | null; siteContact?: string | null; plannedInstallationAt?: string | null; siteConditions?: string | null; installedAt?: string | null; transportCost?: number | null; areas: Array<{ id: string; productionAreaId: string; areaName: string; productionNumber: string; sequence: number; pieceCount?: number | null; isFinalBatch: boolean; installationFee?: number | null }> }>;
};
type ApiCall = <T>(path: string, init?: RequestInit) => Promise<T>;
type FileBuckets = Record<string, UploadFile[]>;

const PRE_REVIEW_ITEMS = ["合同范围与设计范围一致", "CAD图纸和复尺完成日期齐全", "已核对现有材料、颜色和特殊工艺说明", "台面、五金及外购项目已标记", "客户确认记录完整", "交付日期具备可执行性"];
const TECH_REVIEW_ITEMS = ["所有生产区域的海迅资料均与当前设计版本一致", "所有区域实际上传的Excel类别和模板版本正确", "各区域1—4类解析预览的有效物料完整", "复合行拆分、单位和采购计价数量正确", "各区域生产路线与对应车间计划面积可执行"];
const PRODUCTION_RELEASE_ITEMS = ["板式车间资料已发布", "木工（实木）车间资料已发布", "油漆车间资料已发布", "组装车间资料已发布"];
const DATE_ONLY_FIELDS = new Set(["receivedAt", "surveyedAt", "customerConfirmedAt", "plannedAt", "installedAt", "acceptedAt"]);
const INSTALLATION_DATE_PICKER_PROPS = {
  format: "YYYY-MM-DD",
  needConfirm: false,
  placeholder: "请选择计划安装日期",
  style: { width: "100%" },
} as const;
const RECEIPT_DATE_PICKER_PROPS = {
  locale: zhCNDatePickerLocale,
  format: "YYYY-MM-DD",
  needConfirm: false,
  placeholder: "请选择到账日期",
  style: { width: "100%" },
} as const;

type AttachmentDefinition = { name: string; label: string; category: string; accept?: string; required?: boolean; multiple?: boolean };
const MAX_EVIDENCE_FILE_BYTES = 40 * 1024 * 1024;

async function evidenceFileError(definition: AttachmentDefinition, file: File) {
  const extension = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
  const allowed = new Set((definition.accept ?? "").split(",").filter(Boolean));
  if (allowed.size && !allowed.has(extension)) return `“${file.name}”不能上传到${definition.label}`;
  if (file.size <= 0 || file.size > MAX_EVIDENCE_FILE_BYTES) return `“${file.name}”必须大于0字节且不超过40MB`;
  const bytes = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const hex = (count: number) => [...bytes.slice(0, count)].map((value) => value.toString(16).padStart(2, "0")).join("");
  const text = new TextDecoder("ascii").decode(bytes);
  const valid = extension === ".pdf" ? text.startsWith("%PDF-")
    : extension === ".png" ? hex(8) === "89504e470d0a1a0a"
      : [".jpg", ".jpeg"].includes(extension) ? hex(3) === "ffd8ff"
        : extension === ".heic" ? text.slice(4, 8) === "ftyp"
          : extension === ".xlsx" ? hex(4) === "504b0304"
            : extension === ".xls" ? hex(8) === "d0cf11e0a1b11ae1"
              : extension === ".dwg" ? /^AC10\d{2}/.test(text)
                : extension === ".dxf" ? /SECTION|AutoCAD Binary DXF/i.test(text)
                  : true;
  return valid ? null : `“${file.name}”的内容与扩展名不一致`;
}
const attachmentFields: Record<string, AttachmentDefinition[]> = {
  REPORT_DEPOSIT: [{ name: "receiptAttachmentIds", label: "定金收款凭证", category: "DEPOSIT_RECEIPT" }],
  REPORT_PREPAYMENT: [{ name: "receiptAttachmentIds", label: "预付款收款凭证", category: "PREPAYMENT_RECEIPT" }],
  SUBMIT_DESIGN: [
    { name: "cadAttachmentIds", label: "CAD设计图", category: "DESIGN_CAD", accept: ".dwg,.dxf,.pdf,.xls,.xlsx" },
    { name: "confirmationAttachmentIds", label: "客户确认图/签字", category: "DESIGN_CONFIRMATION", accept: ".pdf,.png,.jpg,.jpeg" },
    { name: "sampleBlockAttachmentIds", label: "客户样块", category: "CUSTOMER_SAMPLE_BLOCK", accept: ".pdf,.png,.jpg,.jpeg,.heic", required: false },
  ],
  SUBMIT_TECHNICAL: [
    { name: "haixunAttachmentIds", label: "海迅单", category: "HAIXUN_EXPORT", accept: ".xlsx,.xls,.csv", multiple: true, required: false },
    { name: "decompositionAttachmentIds", label: "分解单", category: "DECOMPOSITION_SHEET", accept: ".xlsx,.xls,.pdf", multiple: true, required: false },
  ],
  REPORT_TAIL_PAYMENT: [{ name: "receiptAttachmentIds", label: "尾款收款凭证", category: "TAIL_PAYMENT_RECEIPT" }],
  COMPLETE_INSTALLATION_BATCH: [{ name: "photoAttachmentIds", label: "本批安装完成照片", category: "INSTALLATION_PHOTO", accept: ".png,.jpg,.jpeg,.heic" }],
  ACCEPT_CUSTOMER: [{ name: "acceptanceAttachmentIds", label: "客户验收签字", category: "CUSTOMER_ACCEPTANCE", accept: ".pdf,.png,.jpg,.jpeg" }],
};

function EvidenceUpload({ definition, files, setFiles, savedCount, clearSaved }: { definition: AttachmentDefinition; files: UploadFile[]; setFiles: (files: UploadFile[]) => void; savedCount: number; clearSaved: () => void }) {
  const { message } = AntApp.useApp();
  return <div className="erp-upload-box">
    <div><RiAttachment2 size={18} /><strong>{definition.label}</strong><span>{savedCount ? `草稿已归档 ${savedCount} 个文件` : `${definition.required === false ? "选传" : "必传"} · 文件进入订单资料库${definition.multiple ? " · 可上传多个" : ""}`}</span></div>
    {savedCount > 0 && <Button size="small" onClick={clearSaved}>清除草稿附件</Button>}
    <Upload multiple beforeUpload={async (file) => { const error = await evidenceFileError(definition, file); if (error) { message.error(error); return Upload.LIST_IGNORE; } return false; }} accept={definition.accept} fileList={files} onChange={({ fileList }) => setFiles(fileList)}>
      <Button icon={<RiUpload2Line size={16} />}>选择文件</Button>
    </Upload>
  </div>;
}

export function WorkflowActionModal<T extends OrderRef>({ order, action, api, paymentAccounts = [], designers = [], installers = [], onCancel, onCompleted, onDraftSaved }: { order: T | null; action: WorkflowAction | null; api: ApiCall; paymentAccounts?: string[]; designers?: Array<{ id: string; name: string }>; installers?: Array<{ id: string; name: string; department: string }>; onCancel: () => void; onCompleted: (order: T) => void; onDraftSaved?: (order: T) => void }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [files, setFiles] = useState<FileBuckets>({});
  const [savedAttachmentIds, setSavedAttachmentIds] = useState<Record<string, string[]>>({});
  const [technicalSupportingAttachmentIds, setTechnicalSupportingAttachmentIds] = useState<Record<string, unknown>>({});
  const [materialPreview, setMaterialPreview] = useState<{ ids: string[]; fileName: string; sheetName: string; lines: MaterialPreviewLine[]; errors: Array<string | { row: number; message: string }> } | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [selectedTechnicalDraftAreaIds, setSelectedTechnicalDraftAreaIds] = useState<string[]>([]);
  const [technicalAutosaveStatus, setTechnicalAutosaveStatus] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle");
  const technicalAutosaveTimer = useRef<number | null>(null);
  const technicalAutosaveQueue = useRef<Promise<void>>(Promise.resolve());
  const latestOrderUpdatedAt = useRef(order?.updatedAt ?? "");
  const lastTechnicalAutosaveFingerprint = useRef("");
  const selectedProductionAreaId = Form.useWatch("productionAreaId", form);
  const command = action?.command ?? "";
  const persistedTechnicalSupportingFiles = inheritTechnicalSupportingFiles({}, [
    ...(order?.stageSubmissions ?? []).filter((submission) => submission.command === "SUBMIT_TECHNICAL").map((submission) => submission.payload),
    ...(order?.productionAreas ?? []).map((area) => area.technicalPackage as unknown as Record<string, unknown> | null | undefined),
  ]);
  const sharedTechnicalSupportingFiles = inheritTechnicalSupportingFiles(technicalSupportingAttachmentIds, [persistedTechnicalSupportingFiles]);
  const readyTechnicalDraftAreas = command === "SUBMIT_TECHNICAL"
    ? (order?.productionAreas ?? []).filter((area) => {
      if (area.technicalPackage?.status === "SUBMITTED") return false;
      const draft = order?.stageSubmissions?.find((submission) => submission.command === "SUBMIT_TECHNICAL" && submission.status === "DRAFT" && String(submission.payload.productionAreaId ?? "") === area.id);
      return hasCompleteTechnicalAreaSubmission(inheritTechnicalSupportingFiles(draft?.payload ?? {}, [sharedTechnicalSupportingFiles]));
    })
    : [];
  const directSubmit = ["ACCEPT_DESIGN", "CONFIRM_DEPOSIT", "CONFIRM_INITIAL_PAYMENTS", "CONFIRM_TAIL_PAYMENT", "APPROVE_PRE_REVIEW", "REJECT_PRE_REVIEW", "APPROVE_TECH_REVIEW", "REJECT_TECH_REVIEW"].includes(command);
  const directSubmitLabel = command === "ACCEPT_DESIGN" ? "确认下单并提交"
    : command === "APPROVE_PRE_REVIEW" ? "逐项核对通过并提交技术部"
    : command === "REJECT_PRE_REVIEW" ? "退回设计师修改"
    : command === "APPROVE_TECH_REVIEW" ? "通过并发布物料版"
    : command === "REJECT_TECH_REVIEW" ? "退回拆单员"
    : "确认到账并提交";
  const paymentReport = order?.stageSubmissions?.find((submission) => submission.command === (command === "CONFIRM_DEPOSIT" ? "REPORT_DEPOSIT" : command === "CONFIRM_TAIL_PAYMENT" ? "REPORT_TAIL_PAYMENT" : ""));
  const depositReport = order?.stageSubmissions?.find((submission) => submission.command === "REPORT_DEPOSIT" && submission.status !== "DRAFT");
  const prepaymentReport = order?.stageSubmissions?.find((submission) => submission.command === "REPORT_PREPAYMENT" && submission.status !== "DRAFT");
  const uploads = attachmentFields[command] ?? [];
  const checklistItems = command === "APPROVE_PRE_REVIEW" ? PRE_REVIEW_ITEMS : command === "APPROVE_TECH_REVIEW" ? TECH_REVIEW_ITEMS : command === "START_PRODUCTION" ? PRODUCTION_RELEASE_ITEMS : [];
  const hasEvidenceStep = uploads.length > 0 || checklistItems.length > 0;
  const reviewStep = hasEvidenceStep ? 2 : 1;

  useEffect(() => { latestOrderUpdatedAt.current = order?.updatedAt ?? latestOrderUpdatedAt.current; }, [order?.updatedAt]);

  useEffect(() => () => {
    if (technicalAutosaveTimer.current !== null) window.clearTimeout(technicalAutosaveTimer.current);
  }, []);

  function restoreFormSubmission(submission?: StageSubmissionRef, base: Record<string, unknown> = {}, supportingFiles: Record<string, unknown> = sharedTechnicalSupportingFiles) {
    const restored: Record<string, unknown> = command === "SUBMIT_TECHNICAL"
      ? inheritTechnicalSupportingFiles({ ...base, ...(submission?.payload ?? {}) }, [supportingFiles])
      : { ...base, ...(submission?.payload ?? {}) };
    const restoredAttachments: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(restored)) {
      if (key.endsWith("AttachmentIds") && Array.isArray(value)) restoredAttachments[key] = value.filter((item): item is string => typeof item === "string");
      else if (key === "checklist" && Array.isArray(value)) restored[key] = value.map((item) => typeof item === "string" ? item : item && typeof item === "object" && (item as { checked?: boolean }).checked ? (item as { label?: string }).label : null).filter((item): item is string => Boolean(item));
      else restored[key] = DATE_ONLY_FIELDS.has(key) && typeof value === "string" ? dayjs(value) : value;
    }
    if (command === "SUBMIT_TECHNICAL" && Number(restored.assemblyQty) > 0) {
      if (restored.panelEnabled === true && restored.woodPaintEnabled !== true && !(Number(restored.panelAssemblyQty) > 0)) restored.panelAssemblyQty = restored.assemblyQty;
      if (restored.woodPaintEnabled === true && restored.panelEnabled !== true && !(Number(restored.woodPaintAssemblyQty) > 0)) restored.woodPaintAssemblyQty = restored.assemblyQty;
    }
    form.resetFields();
    form.setFieldsValue(restored);
    const completeTechnicalDraft = command === "SUBMIT_TECHNICAL" && hasCompleteTechnicalAreaRequiredFields(restored);
    lastTechnicalAutosaveFingerprint.current = completeTechnicalDraft ? JSON.stringify(serializeValues(restored)) : "";
    setTechnicalAutosaveStatus(completeTechnicalDraft ? "saved" : "idle");
    setSavedAttachmentIds(restoredAttachments);
    setFiles({});
    setMaterialPreview(null);
    setDraftRestored(Boolean(submission));
  }

  function selectTechnicalArea(productionAreaId: string) {
    const draft = order?.stageSubmissions?.find((submission) => submission.command === "SUBMIT_TECHNICAL" && submission.status === "DRAFT" && String(submission.payload.productionAreaId ?? "") === productionAreaId);
    restoreFormSubmission(draft, { productionAreaId, designVersion: "V1", panelEnabled: true, woodPaintEnabled: true });
  }

  useEffect(() => {
    if (!action) return;
    setStep(0);
    if (action.command === "SUBMIT_TECHNICAL") {
      const drafts = order?.stageSubmissions?.filter((submission) => submission.command === action.command && submission.status === "DRAFT") ?? [];
      const requestedAreaId = action.productionAreaId && order?.productionAreas?.some((area) => area.id === action.productionAreaId && area.technicalPackage?.status !== "SUBMITTED") ? action.productionAreaId : undefined;
      const draft = requestedAreaId
        ? drafts.find((submission) => String(submission.payload.productionAreaId ?? "") === requestedAreaId)
        : drafts.find((submission) => order?.productionAreas?.some((area) => area.id === String(submission.payload.productionAreaId ?? "") && area.technicalPackage?.status !== "SUBMITTED"));
      const productionAreaId = String(requestedAreaId ?? draft?.payload.productionAreaId ?? order?.productionAreas?.find((area) => area.technicalPackage?.status !== "SUBMITTED")?.id ?? order?.productionAreas?.[0]?.id ?? "");
      setTechnicalSupportingAttachmentIds(persistedTechnicalSupportingFiles);
      restoreFormSubmission(draft, { productionAreaId, designVersion: "V1", panelEnabled: true, woodPaintEnabled: true }, persistedTechnicalSupportingFiles);
      setSelectedTechnicalDraftAreaIds((order?.productionAreas ?? []).filter((area) => {
        if (area.technicalPackage?.status === "SUBMITTED") return false;
        const areaDraft = drafts.find((submission) => String(submission.payload.productionAreaId ?? "") === area.id);
        return hasCompleteTechnicalAreaSubmission(inheritTechnicalSupportingFiles(areaDraft?.payload ?? {}, [persistedTechnicalSupportingFiles]));
      }).map((area) => area.id));
    } else if (action.command === "COMPLETE_INSTALLATION_BATCH") {
      const draft = order?.stageSubmissions?.find((submission) => submission.command === action.command && submission.status === "DRAFT" && String(submission.payload.shipmentId ?? "") === String(action.shipmentId ?? ""));
      restoreFormSubmission(draft, { shipmentId: action.shipmentId });
    } else {
      const draft = order?.stageSubmissions?.find((submission) => submission.command === action.command && submission.status === "DRAFT");
      restoreFormSubmission(draft);
    }
  }, [action, form, order?.id]);

  const dateValue = (key: string, value: unknown) => value && typeof value === "object" && "format" in value ? (value as { format: (pattern: string) => string }).format(DATE_ONLY_FIELDS.has(key) ? "YYYY-MM-DD" : "YYYY-MM-DDTHH:mm:ssZ") : value;

  async function validateAndNext() {
    try {
      if (step === 0) {
        await form.validateFields();
      }
      if (step === 1 && hasEvidenceStep) {
        if (checklistItems.length) await form.validateFields(["checklist"]);
        for (const definition of uploads) if (definition.required !== false && !(files[definition.name]?.length) && !(savedAttachmentIds[definition.name]?.length)) throw new Error(`请上传${definition.label}`);
        if (command === "SUBMIT_DESIGN" && ((files.sampleBlockAttachmentIds?.length ?? 0) + (savedAttachmentIds.sampleBlockAttachmentIds?.length ?? 0) > 0) && !String(form.getFieldValue("sampleBlockRemark") ?? "").trim()) throw new Error("上传客户样块时必须填写样块备注");
        if (command === "SUBMIT_TECHNICAL" && order) {
          const payload = serializeValues(form.getFieldsValue(true));
          const productionAreaId = String(payload.productionAreaId ?? "");
          if (!productionAreaId) throw new Error("请选择要提交的生产区域");
          await uploadPendingFiles(payload);
          const previews = await api<Array<{ id: string; templateType: string; sourceAttachmentId: string; valid: boolean; fileName: string; sheetName: string; lines: MaterialPreviewLine[]; errors: Array<string | { row: number; message: string }> }>>(`/api/v1/material-imports/order/${order.id}/area/${productionAreaId}/drafts`);
          if (!previews.length) throw new Error("请先在订单技术任务的“物料单解析草稿”中上传至少一类Excel");
          if (previews.some((item) => !item.valid)) throw new Error("仍有物料Excel需要修正，请移除或修正源Excel后重新上传");
          const attachmentField: Record<string, string> = { HARDWARE_MATERIALS: "hardwareMaterialAttachmentIds", PAINT_WOOD: "paintWoodAttachmentIds", SOLID_WOOD_DOOR: "solidWoodDoorAttachmentIds", VENEER_DOOR: "veneerDoorAttachmentIds" };
          const materialAttachments = Object.fromEntries(previews.map((item) => [attachmentField[item.templateType], [item.sourceAttachmentId]]));
          const preview = { ids: previews.map((item) => item.id), fileName: "已保存物料解析草稿", sheetName: "物料单 / 下料单", lines: previews.flatMap((item) => item.lines), errors: [] };
          setMaterialPreview(preview);
          form.setFieldsValue({ ...materialAttachments, materialImportIds: preview.ids, materialLines: preview.lines, rowCount: preview.lines.length });
        }
      }
      setStep((value) => value + 1);
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    }
  }

  function serializeValues(values: Record<string, unknown>) {
    const payload: Record<string, unknown> = {};
    Object.entries(values).forEach(([key, value]) => { payload[key] = dateValue(key, value); });
    return payload;
  }

  function scheduleTechnicalAreaAutosave() {
    if (command !== "SUBMIT_TECHNICAL" || step !== 0 || !order || !action) return;
    const values = form.getFieldsValue(true) as Record<string, unknown>;
    if (!hasCompleteTechnicalAreaRequiredFields(values)) {
      if (technicalAutosaveTimer.current !== null) window.clearTimeout(technicalAutosaveTimer.current);
      technicalAutosaveTimer.current = null;
      setTechnicalAutosaveStatus("idle");
      return;
    }
    const payload = serializeValues(values);
    const productionAreaId = String(payload.productionAreaId ?? "");
    const fingerprint = JSON.stringify(payload);
    if (!productionAreaId || fingerprint === lastTechnicalAutosaveFingerprint.current) return;
    if (technicalAutosaveTimer.current !== null) window.clearTimeout(technicalAutosaveTimer.current);
    setTechnicalAutosaveStatus("pending");
    technicalAutosaveTimer.current = window.setTimeout(() => {
      technicalAutosaveTimer.current = null;
      technicalAutosaveQueue.current = technicalAutosaveQueue.current.then(async () => {
        if (fingerprint === lastTechnicalAutosaveFingerprint.current) return;
        if (String(form.getFieldValue("productionAreaId") ?? "") === productionAreaId) setTechnicalAutosaveStatus("saving");
        setSavingDraft(true);
        try {
          const updated = await api<T>(`/api/v1/orders/${order.id}/drafts`, {
            method: "POST",
            headers: { "x-expected-updated-at": latestOrderUpdatedAt.current },
            body: JSON.stringify({ command: action.command, payload }),
          });
          latestOrderUpdatedAt.current = updated.updatedAt ?? latestOrderUpdatedAt.current;
          lastTechnicalAutosaveFingerprint.current = fingerprint;
          if (String(form.getFieldValue("productionAreaId") ?? "") === productionAreaId) setTechnicalAutosaveStatus("saved");
          onDraftSaved?.(updated);
        } catch (error) {
          if (String(form.getFieldValue("productionAreaId") ?? "") === productionAreaId) setTechnicalAutosaveStatus("error");
          message.error(error instanceof Error ? `区域计划自动保存失败：${error.message}` : "区域计划自动保存失败");
        } finally {
          setSavingDraft(false);
        }
      });
    }, 500);
  }

  async function uploadPendingFiles(payload: Record<string, unknown>) {
    if (!order) return savedAttachmentIds;
    const nextSaved = { ...savedAttachmentIds };
    for (const definition of uploads) {
      const ids = [...(savedAttachmentIds[definition.name] ?? [])];
      for (const file of files[definition.name] ?? []) {
        const body = new FormData();
        body.append("category", definition.category);
        body.append("file", file.originFileObj as File);
        const uploaded = await api<{ id: string }>(`/api/v1/attachments/${order.id}`, { method: "POST", body });
        ids.push(uploaded.id);
      }
      payload[definition.name] = ids;
      nextSaved[definition.name] = ids;
    }
    setSavedAttachmentIds(nextSaved);
    if (command === "SUBMIT_TECHNICAL") setTechnicalSupportingAttachmentIds(inheritTechnicalSupportingFiles({}, [nextSaved]));
    setFiles({});
    return nextSaved;
  }

  async function saveDraft() {
    if (!order || !action) return;
    setSavingDraft(true);
    try {
      const payload = serializeValues(form.getFieldsValue(true));
      await uploadPendingFiles(payload);
      const updated = await api<T>(`/api/v1/orders/${order.id}/drafts`, { method: "POST", headers: { "x-expected-updated-at": latestOrderUpdatedAt.current }, body: JSON.stringify({ command: action.command, payload }) });
      latestOrderUpdatedAt.current = updated.updatedAt ?? latestOrderUpdatedAt.current;
      if (command === "SUBMIT_TECHNICAL" && hasCompleteTechnicalAreaSubmission(payload)) {
        const productionAreaId = String(payload.productionAreaId ?? "");
        setSelectedTechnicalDraftAreaIds((current) => productionAreaId && !current.includes(productionAreaId) ? [...current, productionAreaId] : current);
      }
      message.success(command === "SUBMIT_TECHNICAL" ? "当前区域完整资料已保存，可继续准备其他区域或批量提交" : "当前已填资料已保存为草稿，订单阶段未推进");
      onDraftSaved?.(updated);
      return updated;
    } catch (error) { message.error(error instanceof Error ? error.message : "草稿保存失败"); }
    finally { setSavingDraft(false); }
  }

  async function saveTechnicalAreaForBatch() {
    const updated = await saveDraft();
    if (updated) setStep(0);
  }

  async function bulkSubmitTechnicalDrafts() {
    if (!order || !selectedTechnicalDraftAreaIds.length) return;
    setSaving(true);
    try {
      const updated = await api<T>(`/api/v1/orders/${order.id}/technical-packages/bulk-submit`, {
        method: "POST",
        headers: { "x-expected-updated-at": latestOrderUpdatedAt.current },
        body: JSON.stringify({ productionAreaIds: selectedTechnicalDraftAreaIds }),
      });
      const remaining = (updated.productionAreas ?? []).filter((area) => area.technicalPackage?.status !== "SUBMITTED");
      message.success(remaining.length
        ? `已一次提交 ${selectedTechnicalDraftAreaIds.length} 个区域；还有 ${remaining.length} 个区域可继续准备`
        : "全部区域技术包已提交，请点击“提交并锁定所有区域”开启技术审单");
      onCompleted(updated);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "批量提交区域技术包失败");
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    if (!order || !action) return;
    setSaving(true);
    try {
      await form.validateFields();
      const values = await collectPreservedFormValues(form);
      const payload = serializeValues(values);
      if (command === "RECORD_DELIVERY") {
        const routeSelection = payload.productionRouteSelection && typeof payload.productionRouteSelection === "object" && !Array.isArray(payload.productionRouteSelection)
          ? payload.productionRouteSelection as Record<string, unknown>
          : {};
        const routeFinalFlags = payload.productionRouteFinalFlags && typeof payload.productionRouteFinalFlags === "object" && !Array.isArray(payload.productionRouteFinalFlags)
          ? payload.productionRouteFinalFlags as Record<string, unknown>
          : {};
        payload.productionRouteBatches = Object.entries(routeSelection)
          .filter(([, selected]) => selected === true)
          .map(([productionRouteId]) => ({ productionRouteId, isFinalBatch: routeFinalFlags[productionRouteId] === true }));
        delete payload.productionRouteSelection;
        delete payload.productionRouteFinalFlags;
        const areaLines = Array.isArray(payload.areaLines) ? payload.areaLines : [];
        const productionRouteBatches = Array.isArray(payload.productionRouteBatches) ? payload.productionRouteBatches : [];
        const outsourceLineIds = Array.isArray(payload.outsourceLineIds) ? payload.outsourceLineIds : [];
        if (!areaLines.length && !productionRouteBatches.length && !outsourceLineIds.length) throw new Error("请至少选择一条可发产品路线或已齐套外购产品");
      }
      if (checklistItems.length) payload.checklist = checklistItems.map((label) => ({ label, checked: (values.checklist as string[] | undefined)?.includes(label) ?? false }));
      await uploadPendingFiles(payload);
      const updated = action.command === "COMPLETE_INSTALLATION_BATCH"
        ? await api<T>(`/api/v1/orders/${order.id}/shipments/${action.shipmentId}/complete-installation`, { method: "POST", headers: { "x-expected-updated-at": order.updatedAt ?? "" }, body: JSON.stringify(payload) })
        : await api<T>(`/api/v1/orders/${order.id}/commands`, { method: "POST", headers: { "x-expected-updated-at": order.updatedAt ?? "" }, body: JSON.stringify({ command: action.command, payload }) });
      const remainingTechnicalAreas = command === "SUBMIT_TECHNICAL"
        ? (updated.productionAreas ?? []).filter((area) => area.technicalPackage?.status !== "SUBMITTED")
        : [];
      message.success(command === "SUBMIT_TECHNICAL"
        ? remainingTechnicalAreas.length
          ? `当前区域技术包已提交；还有 ${remainingTechnicalAreas.length} 个区域待分别提交`
          : "全部区域技术包已提交，请点击“提交并锁定所有区域”开启技术审单"
        : command === "ACCEPT_DESIGN" ? "设计下单已确认，承诺时限和下一任务已同步更新"
        : command === "APPROVE_PRE_REVIEW" ? "前置审单已通过，订单已提交技术部"
        : command === "REJECT_PRE_REVIEW" ? "已退回设计师修改，生产编号保持不变"
        : ["CONFIRM_DEPOSIT", "CONFIRM_INITIAL_PAYMENTS", "CONFIRM_TAIL_PAYMENT"].includes(command) ? "到账核验已提交，订单状态与下一责任人已同步更新"
        : "资料已归档，订单状态与下一责任人已同步更新");
      onCompleted(updated);
    } catch (error) { message.error(error instanceof Error ? error.message : "提交失败"); }
    finally { setSaving(false); }
  }

  function evidenceFields() {
    switch (command) {
      case "REPORT_DEPOSIT": case "REPORT_PREPAYMENT": case "REPORT_TAIL_PAYMENT": return <>
        <Form.Item name="receivedAmount" label="本次到账金额" rules={[{ required: true }]}><InputNumber min={0.01} prefix="¥" style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="receivedAt" label="到账日期" rules={[{ required: true }]}><DatePicker {...RECEIPT_DATE_PICKER_PROPS} /></Form.Item>
        <Form.Item name="account" label="收款账户" rules={[{ required: true }]}><Select options={paymentAccounts.map((value) => ({ value, label: value }))} placeholder="选择董事长已批准的收款账户" /></Form.Item>
      </>;
      case "CONFIRM_DEPOSIT": case "CONFIRM_TAIL_PAYMENT": return <>
        <Alert className="span-2" type="info" showIcon title="收款账户、金额、到账日期和凭证已由销售报备；财务只需到对应账户核对实际到账。" />
        <Descriptions className="span-2" bordered size="small" column={2} items={[
          { key: "account", label: "销售报备账户", children: String(paymentReport?.payload.account ?? "—") },
          { key: "amount", label: "报备金额", children: paymentReport?.payload.receivedAmount ? `¥${Number(paymentReport.payload.receivedAmount).toLocaleString("zh-CN")}` : "—" },
          { key: "time", label: "报备到账日期", children: paymentReport?.payload.receivedAt ? dayjs(String(paymentReport.payload.receivedAt)).format("YYYY-MM-DD") : "—" },
          { key: "receipt", label: "收款凭证", children: `${Array.isArray(paymentReport?.payload.receiptAttachmentIds) ? paymentReport.payload.receiptAttachmentIds.length : 0} 个附件（已归档）` },
        ]} />
        <Form.Item className="span-2" name="verified" valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error("请确认已实际核验到账")) }]}><Checkbox>已在销售报备的收款账户中查到该笔资金，确认实际到账</Checkbox></Form.Item>
        <Form.Item className="span-2" name="comment" label="财务备注"><Input.TextArea rows={3} placeholder="可记录银行流水后四位或差异说明" /></Form.Item>
      </>;
      case "CONFIRM_INITIAL_PAYMENTS": return <>
        <Alert className="span-2" type="info" showIcon title="财务必须在同一页面分别查到定金和预付款，两笔都确认后订单才交予设计师。" />
        <Descriptions className="span-2" bordered size="small" column={2} items={[
          { key: "deposit", label: "定金", children: `${depositReport?.payload.receivedAmount ? `¥${Number(depositReport.payload.receivedAmount).toLocaleString("zh-CN")}` : "—"} · ${String(depositReport?.payload.account ?? "—")} · ${depositReport?.payload.receivedAt ? dayjs(String(depositReport.payload.receivedAt)).format("YYYY-MM-DD") : "—"}` },
          { key: "prepayment", label: "预付款", children: `${prepaymentReport?.payload.receivedAmount ? `¥${Number(prepaymentReport.payload.receivedAmount).toLocaleString("zh-CN")}` : "—"} · ${String(prepaymentReport?.payload.account ?? "—")} · ${prepaymentReport?.payload.receivedAt ? dayjs(String(prepaymentReport.payload.receivedAt)).format("YYYY-MM-DD") : "—"}` },
          { key: "depositReceipt", label: "定金凭证", children: `${Array.isArray(depositReport?.payload.receiptAttachmentIds) ? depositReport.payload.receiptAttachmentIds.length : 0} 个附件（已归档）` },
          { key: "prepaymentReceipt", label: "预付款凭证", children: `${Array.isArray(prepaymentReport?.payload.receiptAttachmentIds) ? prepaymentReport.payload.receiptAttachmentIds.length : 0} 个附件（已归档）` },
        ]} />
        <Form.Item className="span-2" name="depositVerified" valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error("请确认定金实际到账")) }]}><Checkbox>已在对应账户查到定金，确认实际到账</Checkbox></Form.Item>
        <Form.Item className="span-2" name="prepaymentVerified" valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error("请确认预付款实际到账")) }]}><Checkbox>已在对应账户查到预付款，确认实际到账</Checkbox></Form.Item>
        <Form.Item className="span-2" name="comment" label="财务备注"><Input.TextArea rows={3} placeholder="可分别记录两笔银行流水后四位或差异说明" /></Form.Item>
      </>;
      case "ACCEPT_DESIGN": return <><Form.Item name="designLeadDays" label="设计承诺时限" extra="下单后1–7个工作日，确认后不可修改" rules={[{ required: true, type: "number", min: 1, max: 7, message: "请输入1至7之间的整数工作日" }, { validator: (_, value) => value === undefined || Number.isInteger(value) ? Promise.resolve() : Promise.reject(new Error("设计承诺天数必须是整数")) }]}><InputNumber placeholder="请输入1–7" addonAfter="工作日" style={{ width: "100%" }} /></Form.Item><Form.Item name="scopeConfirmed" valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error("请确认已阅读合同范围")) }]}><Checkbox>已阅读合同、现场类型、客户交期与需求，并确认下单</Checkbox></Form.Item></>;
      case "RETURN_DESIGN": return <Form.Item name="reason" label="退回销售原因" className="span-2" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={5} placeholder="说明无法下单的原因，退回后由销售重新分配设计师" /></Form.Item>;
      case "ASSIGN_DESIGNER": return <Form.Item name="designerId" label="重新分配设计师" className="span-2" rules={[{ required: true }]}><Select placeholder="仅显示启用中的设计师" options={designers.map((designer) => ({ value: designer.id, label: designer.name }))} /></Form.Item>;
      case "TRANSFER_DESIGN": return <><Form.Item name="designerId" label="转给其他设计师" rules={[{ required: true }]}><Select placeholder="选择另一名启用设计师" options={designers.filter((designer) => designer.id !== order?.designer?.id).map((designer) => ({ value: designer.id, label: designer.name }))} /></Form.Item><Form.Item name="reason" label="转交原因" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={4} placeholder="说明转交原因；原正式设计截止时间不会改变" /></Form.Item></>;
      case "REJECT_PRE_REVIEW": case "REJECT_TECH_REVIEW": return <Form.Item name="reason" label="退回原因" className="span-2" rules={[{ required: true }]}><Input.TextArea rows={5} placeholder="写清具体问题、修改要求和再次提交标准" /></Form.Item>;
      case "APPROVE_PRE_REVIEW": return <>
        <Alert className="span-2" type="info" showIcon title="可先保存已核对的项目和审单意见，下次打开继续；全部核对后再提交技术部。" />
        <Form.Item className="span-2" name="checklist" label={<div className="erp-review-label"><span>前置审单逐项核对（正式提交时须全部确认）</span><Button type="link" size="small" htmlType="button" onClick={() => { form.setFieldValue("checklist", PRE_REVIEW_ITEMS); form.setFields([{ name: "checklist", errors: [] }]); }}>一键全部通过</Button></div>} rules={[{ validator: (_, value) => Array.isArray(value) && value.length === PRE_REVIEW_ITEMS.length ? Promise.resolve() : Promise.reject(new Error("请完成全部前置审单检查项")) }]}><Checkbox.Group className="erp-review-checklist" options={PRE_REVIEW_ITEMS} /></Form.Item>
        <Form.Item className="span-2" name="comment" label="审单意见"><Input.TextArea rows={3} placeholder="可记录判断依据或后续需要技术部关注的事项" /></Form.Item>
      </>;
      case "APPROVE_TECH_REVIEW": return <>
        <Alert className="span-2" type={draftRestored ? "success" : "info"} showIcon title={draftRestored ? "已恢复上次保存的整单技术审单进度，可继续核对。" : "订单管理员在同一页面审核全部生产区域；任一区域不通过都会退回整个拆单集合。"} />
        <Descriptions className="span-2" bordered size="small" column={2} items={[
          { key: "areas", label: "锁定生产区域", children: `${order?.productionAreas?.length ?? 0} 个` },
          { key: "rows", label: "物料有效行合计", children: `${(order?.productionAreas ?? []).reduce((sum, area) => sum + (area.technicalPackage?.rowCount ?? 0), 0)} 行` },
          { key: "routes", label: "区域与路线", span: 2, children: (order?.productionAreas ?? []).map((area) => `${area.name}（${area.productionNumber}）· ${area.route?.panelEnabled ? "板式" : ""}${area.route?.panelEnabled && area.route?.woodPaintEnabled ? "+" : ""}${area.route?.woodPaintEnabled ? "木工+油漆" : ""} · ${area.technicalPackage?.materialImports?.length ?? 0}类Excel`).join("；") || "—" },
          { key: "outsource", label: "订单级外购成品", span: 2, children: order?.outsourceRequirement?.declaresNone ? "已明确声明无外购成品" : order?.outsourceRequirement?.lines?.length ? order.outsourceRequirement.lines.map((line) => `${line.name} ${line.plannedQty}${line.unit}${line.usageArea ? `（${line.usageArea}）` : ""}`).join("；") : "历史订单豁免新外购声明" },
        ]} />
        <Form.Item className="span-2" name="checklist" label={<div className="erp-review-label"><span>逐项复核（正式发布前必须全部通过）</span><Button type="link" size="small" htmlType="button" onClick={() => { form.setFieldValue("checklist", TECH_REVIEW_ITEMS); form.setFields([{ name: "checklist", errors: [] }]); }}>一键全部通过</Button></div>} rules={[{ validator: (_, value) => Array.isArray(value) && value.length === TECH_REVIEW_ITEMS.length ? Promise.resolve() : Promise.reject(new Error("请完成全部技术复核项")) }]}><Checkbox.Group className="erp-review-checklist" options={TECH_REVIEW_ITEMS} /></Form.Item>
        <Form.Item className="span-2" name="comment" label="复核意见"><Input.TextArea rows={3} placeholder="记录物料异常、人工核定依据或后续关注项" /></Form.Item>
      </>;
      case "SUBMIT_DESIGN": return <>
        <Form.Item name="designVersion" label="设计版本" initialValue="V1" rules={[{ required: true }]}><Input placeholder="例如 V1" /></Form.Item>
        <Form.Item name="surveyedAt" label="复尺完成日期" rules={[{ required: true }]}><DatePicker needConfirm={false} showNow={false} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="customerConfirmedAt" label="客户确认日期" rules={[{ required: true }]}><DatePicker needConfirm={false} showNow={false} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="spaces" label="空间清单摘要（选填）"><Input.TextArea rows={3} placeholder="玄关、厨房、主卧……" /></Form.Item>
        <Form.Item name="materials" label="材料/颜色/特殊工艺（选填）" className="span-2"><Input.TextArea rows={3} placeholder="板材、门型、颜色、拉手与特殊工艺" /></Form.Item>
      </>;
      case "SUBMIT_TECHNICAL": {
        const selectedArea = order?.productionAreas?.find((area) => area.id === selectedProductionAreaId);
        return <>
        <div className="span-2 erp-technical-area-picker">
          {(order?.productionAreas ?? []).map((area) => {
            const draft = order?.stageSubmissions?.find((submission) => submission.command === "SUBMIT_TECHNICAL" && submission.status === "DRAFT" && String(submission.payload.productionAreaId ?? "") === area.id);
            const submitted = area.technicalPackage?.status === "SUBMITTED";
            const values = draft?.payload;
            const effectiveValues = inheritTechnicalSupportingFiles(values ?? {}, [sharedTechnicalSupportingFiles]);
            const submissionReady = hasCompleteTechnicalAreaSubmission(effectiveValues);
            const requiredFieldsComplete = hasCompleteTechnicalAreaRequiredFields(values);
            const submissionGaps = technicalAreaSubmissionGaps(effectiveValues);
            const summary = area.technicalPackage
              ? `板式 ${area.technicalPackage.panelEnabled ? `${area.technicalPackage.panelPlanQty ?? "已填"}→组装${area.technicalPackage.panelAssemblyPlanQty ?? "待填"}` : "不启用"} · 实木油漆 ${area.technicalPackage.woodPaintEnabled ? `${area.technicalPackage.woodPlanQty ?? "已填"}/${area.technicalPackage.paintPlanQty ?? "已填"}→组装${area.technicalPackage.woodPaintAssemblyPlanQty ?? "待填"}` : "不启用"}`
              : draft ? `板式 ${values?.panelEnabled ? `${values.panelQty ?? "待填"}→组装${values.panelAssemblyQty ?? "待填"}` : "不启用"} · 实木油漆 ${values?.woodPaintEnabled ? `${values.woodQty ?? "待填"}/${values.paintQty ?? "待填"}→组装${values.woodPaintAssemblyQty ?? "待填"}` : "不启用"}` : "尚未填写该区域的车间计划";
            return <button type="button" key={area.id} disabled={submitted} className={area.id === selectedProductionAreaId ? "selected" : ""} onClick={() => selectTechnicalArea(area.id)}>
              <span><strong>{area.name}</strong><small>{area.productionNumber}</small></span>
              <Tag color={submitted || submissionReady ? "success" : draft ? "warning" : "default"}>{submitted ? "已提交" : submissionReady ? "资料已就绪" : requiredFieldsComplete ? "计划已完成 · 待补资料" : draft ? "待补充" : "待填写"}</Tag>
              <p>{summary}</p>
              {!submitted && requiredFieldsComplete && !submissionReady && <small className="erp-technical-area-gaps">待补：{submissionGaps.join("、")}</small>}
            </button>;
          })}
        </div>
        <Alert className="span-2" type="info" showIcon title={`当前正在编辑${selectedArea ? `“${selectedArea.name}”` : "选中区域"}`} description="海迅文件和分解单属于整张订单，只需上传一次并由所有区域共同引用；各区域只需分别完成路线计划和自己的物料解析。" />
        {readyTechnicalDraftAreas.length > 0 && <div className="span-2 erp-technical-bulk-submit">
          <div><strong>批量提交已就绪区域</strong><span>只有显示“资料已就绪”的区域会列在这里；可选择一个或多个，任一区域失败时本次全部回滚</span></div>
          <Checkbox.Group value={selectedTechnicalDraftAreaIds} onChange={(values) => setSelectedTechnicalDraftAreaIds(values.map(String))} options={readyTechnicalDraftAreas.map((area) => ({ value: area.id, label: `${area.name} · ${area.productionNumber}` }))} />
          <Button type="primary" disabled={!selectedTechnicalDraftAreaIds.length} loading={saving} onClick={bulkSubmitTechnicalDrafts}>一次提交所选区域（{selectedTechnicalDraftAreaIds.length}）</Button>
        </div>}
        <Form.Item name="productionAreaId" hidden rules={[{ required: true, message: "请选择生产区域" }]}><Input /></Form.Item>
        <div className="span-2 erp-technical-section-title"><strong>区域资料与校验</strong><span>物料Excel请先在订单技术任务的独立解析区按实际类别上传</span></div>
        <Form.Item name="designVersion" label="对应设计版本" initialValue="V1" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item label="有效物料行数" extra="无需手工填写；上传物料单/下料单后由系统读取目标工作表并自动统计"><Input value="上传文件后自动统计" disabled /></Form.Item>
        <Form.Item name="rowCount" hidden><InputNumber /></Form.Item>
        <Form.Item name="materialImportIds" hidden><Input /></Form.Item>
        <Form.Item name="validationSummary" label="校验结果摘要（选填）" className="span-2"><Input.TextArea rows={4} placeholder="可记录柜体/门板/五金/台面数量、缺失字段、不可制造项及处理结论" /></Form.Item>
        <div className="span-2 erp-technical-section-title"><strong>{selectedArea ? `${selectedArea.name}的路线生产计划` : "路线生产计划"}</strong><span>每条启用路线分别填写组装面积 · {technicalAutosaveStatus === "pending" ? "等待自动保存" : technicalAutosaveStatus === "saving" ? "正在自动保存…" : technicalAutosaveStatus === "saved" ? "已自动保存" : technicalAutosaveStatus === "error" ? "自动保存失败，请继续修改后重试" : "填完后自动保存"}</span></div>
        <div className="span-2 erp-technical-route-plans">
          <section className="erp-technical-route-card erp-panel-route-plan">
            <header><div><strong>板式路线</strong><span>板式车间 → 本路线组装</span></div><Form.Item name="panelEnabled" valuePropName="checked" initialValue={true}><Checkbox>启用本路线</Checkbox></Form.Item></header>
            <Form.Item noStyle shouldUpdate={(previous, current) => previous.panelEnabled !== current.panelEnabled}>{({ getFieldValue }) => getFieldValue("panelEnabled") ? <div className="erp-technical-route-fields"><Form.Item name="panelQty" label="板式车间计划面积" rules={[{ required: true }]}><InputNumber min={0.001} addonAfter="㎡" style={{ width: "100%" }} /></Form.Item><Form.Item name="panelAssemblyQty" label="板式路线组装面积" rules={[{ required: true }]}><InputNumber min={0.001} addonAfter="㎡" style={{ width: "100%" }} /></Form.Item></div> : <div className="erp-technical-route-disabled">本区域不启用板式路线</div>}</Form.Item>
          </section>
          <section className="erp-technical-route-card erp-wood-paint-route-plan">
            <header><div><strong>木工＋油漆路线</strong><span>木工（实木）→ 油漆车间 → 本路线组装</span></div><Form.Item name="woodPaintEnabled" valuePropName="checked" initialValue={true}><Checkbox>启用本路线</Checkbox></Form.Item></header>
            <Form.Item noStyle shouldUpdate={(previous, current) => previous.woodPaintEnabled !== current.woodPaintEnabled}>{({ getFieldValue }) => getFieldValue("woodPaintEnabled") ? <><Form.Item className="erp-veneer-choice" name="veneerRequired" valuePropName="checked" initialValue={false}><Checkbox>本区域实木工艺需要贴皮</Checkbox></Form.Item><div className="erp-technical-route-fields"><Form.Item name="woodQty" label="木工（实木）计划面积" rules={[{ required: true }]}><InputNumber min={0.001} addonAfter="㎡" style={{ width: "100%" }} /></Form.Item><Form.Item name="paintQty" label="油漆车间计划面积" rules={[{ required: true }]}><InputNumber min={0.001} addonAfter="㎡" style={{ width: "100%" }} /></Form.Item><Form.Item name="woodPaintAssemblyQty" label="木工＋油漆路线组装面积" rules={[{ required: true }]}><InputNumber min={0.001} addonAfter="㎡" style={{ width: "100%" }} /></Form.Item></div></> : <div className="erp-technical-route-disabled">本区域不启用木工＋油漆路线</div>}</Form.Item>
          </section>
        </div>
      </>;
      }
      case "START_PRODUCTION": return <>
        <Form.Item name="planVersion" label="生产计划版本" rules={[{ required: true }]} initialValue="P1"><Input /></Form.Item>
        <Alert className="span-2" type="info" showIcon title="填写各车间计划面积；下达后，每道工序可分别报开工、部分完成、全部完成或异常。" />
        <Form.Item name="panelQty" label="板式车间计划面积" rules={[{ required: true }]}><InputNumber min={0.001} addonAfter="㎡" style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="woodQty" label="木工（实木）计划面积" rules={[{ required: true }]}><InputNumber min={0.001} addonAfter="㎡" style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="paintQty" label="油漆车间计划面积" rules={[{ required: true }]}><InputNumber min={0.001} addonAfter="㎡" style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="assemblyQty" label="组装车间计划面积" rules={[{ required: true }]}><InputNumber min={0.001} addonAfter="㎡" style={{ width: "100%" }} /></Form.Item>
      </>;
      case "RECORD_DELIVERY": {
        const areas = (order?.productionAreas ?? []).filter((area) => area.production?.complete && !area.shipped);
        const allowedRouteIds = new Set(order?.shipmentGate?.allowedProductionRouteIds ?? []);
        const routeAreas = (order?.productionAreas ?? []).map((area) => ({ ...area, routes: (area.routes ?? []).filter((route) => allowedRouteIds.has(route.id)) })).filter((area) => area.routes.length);
        const lines = (order?.fulfillmentTracks?.outsourced.lines ?? []).filter((line) => line.canShip);
        return <>
          <Alert className="span-2" type="info" showIcon title="选择本车次要发的产品" description="车间产品与已齐套外购产品可同车登记，也可只选一类；两类产品仍分别校验各自的发货条件。" />
          <div className="span-2 erp-technical-section-title"><strong>车间产品</strong><span>{order?.productionExecutionMode === "ROUTE_V2" ? (routeAreas.length ? "已完工路线可分多批发货；请由订单管理员确认本次是否为各路线末批" : "当前无可发货路线") : (areas.length ? "可选择一个或多个已完工区域" : "当前无可发货的已完工区域")}</span></div>
          {order?.productionExecutionMode === "ROUTE_V2" ? <div className="span-2 erp-route-shipment-picker">{routeAreas.map((area) => <div key={area.id} className="erp-route-shipment-group"><strong>{area.name} · {area.productionNumber}</strong><div className="erp-route-shipment-lines">{area.routes.map((route) => <div key={route.id} className="erp-route-shipment-line"><Form.Item name={["productionRouteSelection", route.id]} valuePropName="checked" noStyle><Checkbox>{route.label} · 已完工{route.shipmentBatches?.length ? ` · 已发${route.shipmentBatches.length}批` : ""}</Checkbox></Form.Item><Form.Item noStyle shouldUpdate={(previous, current) => previous.productionRouteSelection?.[route.id] !== current.productionRouteSelection?.[route.id]}>{({ getFieldValue }) => <Form.Item name={["productionRouteFinalFlags", route.id]} valuePropName="checked" noStyle><Checkbox disabled={!getFieldValue(["productionRouteSelection", route.id])}>本路线本次为最后一批</Checkbox></Form.Item>}</Form.Item></div>)}</div></div>)}</div> : <Form.List name="areaLines" initialValue={[]}>
            {(fields, { add, remove }) => <div className="span-2">
              {fields.map((field) => <div key={field.key} className="erp-form-grid">
                <Form.Item name={[field.name, "productionAreaId"]} label="生产区域" rules={[{ required: true }]}><Select options={areas.map((area) => ({ value: area.id, label: `${area.name} · ${area.productionNumber}` }))} /></Form.Item>
                <Form.Item name={[field.name, "isFinalBatch"]} valuePropName="checked"><Checkbox>这是该区域最后一批</Checkbox></Form.Item>
                <Button danger type="link" onClick={() => remove(field.name)}>不发该区域</Button>
              </div>)}
              <Button type="dashed" onClick={() => add()} disabled={!areas.length || fields.length >= areas.length}>添加本车次车间产品</Button>
            </div>}
          </Form.List>}
          <Form.Item className="span-2" noStyle shouldUpdate>{({ getFieldValue }) => {
            const selectedAreaIds: string[] = (order?.productionExecutionMode === "ROUTE_V2"
              ? [...new Set(Object.entries((getFieldValue("productionRouteSelection") ?? {}) as Record<string, unknown>).filter(([, selected]) => selected === true).map(([routeId]) => routeAreas.find((area) => area.routes.some((route) => route.id === routeId))?.id).filter(Boolean))]
              : [...new Set((getFieldValue("areaLines") ?? []).map((line: { productionAreaId?: string }) => line?.productionAreaId).filter(Boolean))]) as string[];
            return selectedAreaIds.length ? <div className="span-2 erp-form-grid"><div className="span-2 erp-technical-section-title"><strong>本车次区域安装费</strong><span>同一区域多条路线同车只登记一笔；首批与后续批次规则一致</span></div>{selectedAreaIds.map((areaId: string) => {
              const area = (order?.productionAreas ?? []).find((candidate) => candidate.id === areaId)!;
              const legacyFee = !area.shipmentBatches?.length ? area.technicalPackage?.firstBatchInstallationFee : null;
              return <Form.Item key={areaId} name={["installationFees", areaId]} label={`${area.name} · ${area.productionNumber}`} initialValue={legacyFee == null ? undefined : Number(legacyFee)} rules={[{ required: true, message: "请输入本区域本批安装费" }]}><InputNumber min={0} precision={2} prefix="¥" style={{ width: "100%" }} /></Form.Item>;
            })}<div className="span-2 erp-technical-section-title"><strong>本车次安装安排</strong><span>发货后将任务直接分配给选中的安装人员</span></div><Form.Item name="assignedInstallerId" label="安装负责人" rules={[{ required: true, message: "请选择安装负责人" }]}><Select showSearch optionFilterProp="label" options={installers.map((installer) => ({ value: installer.id, label: `${installer.name} · ${installer.department}` }))} placeholder="选择在职安装人员" /></Form.Item><Form.Item name="installationTeamLabel" label="安装班组" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="contact" label="现场联系人" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="plannedAt" label="计划安装日期" rules={[{ required: true }]}><DatePicker {...INSTALLATION_DATE_PICKER_PROPS} /></Form.Item><Form.Item name="supplyChecks" label="安装资料与现场条件" className="span-2" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item></div> : null;
          }}</Form.Item>
          <div className="span-2 erp-technical-section-title"><strong>外购产品</strong><span>{lines.length ? "仅显示已齐套且未发货的产品" : "当前无可发货外购产品"}</span></div>
          <Form.Item className="span-2" name="outsourceLineIds" label="本车次外购产品"><Checkbox.Group options={lines.map((line) => ({ value: line.id, label: `${line.name} · ${line.plannedQty} ${line.unit}${line.usageArea ? ` · ${line.usageArea}` : ""}` }))} /></Form.Item>
          <Form.Item className="span-2" name="vehicle" label="车辆/司机" rules={[{ required: true }]}><Input /></Form.Item>
        </>;
      }
      case "COMPLETE_INSTALLATION_BATCH": {
        const shipment = order?.shipments?.find((item) => item.id === action?.shipmentId);
        return <>
          <Form.Item name="shipmentId" hidden><Input /></Form.Item>
          <Alert className="span-2" type="info" showIcon title={`完成发货批次安装 · ${shipment?.vehicle ?? ""}`} description={`${(shipment?.areas ?? []).map((line) => `${line.areaName}第${line.sequence}批${line.isFinalBatch ? " · 末批" : ""}`).join("；")}${shipment?.plannedInstallationAt ? `；原安排 ${shipment.assignedInstaller?.name ?? "未知负责人"} · ${shipment.installationTeamLabel ?? shipment.installationDepartment ?? "安装班组"} · ${dayjs(shipment.plannedInstallationAt).format("YYYY-MM-DD")} · ${shipment.siteContact ?? "未填联系人"}` : "；历史车次未关联安装安排"}`} />
          {(shipment?.areas ?? []).map((line) => <Form.Item key={line.id} label={`${line.areaName}第${line.sequence}批安装费`}><Input value={`¥${Number(line.installationFee ?? 0).toFixed(2)}（发货登记已确认）`} disabled /></Form.Item>)}
          <Form.Item name="transportCost" label="本车次运输费用" rules={[{ required: true }]}><InputNumber min={0} precision={2} prefix="¥" style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="installedAt" label="安装完成日期" rules={[{ required: true }]}><DatePicker {...INSTALLATION_DATE_PICKER_PROPS} placeholder="请选择安装完成日期" /></Form.Item>
          <Form.Item name="installer" label="安装负责人" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="issueConclusion" label="遗留问题/处理结论（选填）" className="span-2"><Input.TextArea rows={3} placeholder="如有遗留问题或现场处理结果可填写" /></Form.Item>
        </>;
      }
      case "ACCEPT_CUSTOMER": return <><Form.Item name="acceptedAt" label="客户验收签字日期" className="erp-acceptance-field" rules={[{ required: true }]}><DatePicker {...INSTALLATION_DATE_PICKER_PROPS} placeholder="请选择客户验收签字日期" /></Form.Item><Form.Item name="customerConclusion" label="客户验收结论" className="erp-acceptance-field" rules={[{ required: true }]}><Input.TextArea rows={1} placeholder="填写客户验收结论" /></Form.Item></>;
      default: return null;
    }
  }

  const modalClassName = ["SUBMIT_TECHNICAL", "APPROVE_TECH_REVIEW"].includes(command)
    ? "erp-technical-submit-modal"
    : command === "ACCEPT_DESIGN"
      ? "erp-compact-action-modal"
      : command === "ACCEPT_CUSTOMER"
        ? "erp-customer-acceptance-modal"
        : undefined;
  const modalWidth = command === "ACCEPT_DESIGN" ? 560 : command === "ACCEPT_CUSTOMER" ? 680 : 850;

  return <Modal className={modalClassName} title={`${action?.label ?? "节点办理"} · ${order?.salesNumber ?? order?.trackingSerial ?? ""}`} width={modalWidth} open={Boolean(action)} onCancel={onCancel} footer={null} destroyOnHidden>
      {!directSubmit && <Steps size="small" current={step} items={hasEvidenceStep ? [{ title: "填写业务信息" }, { title: command === "SUBMIT_TECHNICAL" ? "整单资料与逐项核对" : "资料与逐项核对" }, { title: "确认并提交" }] : [{ title: "填写业务信息" }, { title: "确认并提交" }]} />}
    <Form form={form} layout="vertical" className="erp-action-form" onValuesChange={scheduleTechnicalAreaAutosave}>
      <div className="erp-action-content">
      {(directSubmit || step === 0) && <div className="erp-form-grid">{evidenceFields() ?? <Alert className="span-2" type="info" showIcon title="请先核对本节点业务事实，下一步完成资料或检查项后才能推进状态。" />}</div>}
      {!directSubmit && hasEvidenceStep && step === 1 && <div className="erp-evidence-step">
        {command === "SUBMIT_TECHNICAL" && <div className="erp-technical-section-title"><strong>整单共用文件（可选）</strong><span>海迅单和分解单均为可选资料，各自支持多文件；如上传，所有生产区域共同引用，只需上传一次</span></div>}
        {uploads.map((definition) => <EvidenceUpload key={definition.name} definition={definition} files={files[definition.name] ?? []} savedCount={savedAttachmentIds[definition.name]?.length ?? 0} clearSaved={() => setSavedAttachmentIds((current) => ({ ...current, [definition.name]: [] }))} setFiles={(list) => setFiles((current) => ({ ...current, [definition.name]: list }))} />)}
        {command === "SUBMIT_DESIGN" && <Form.Item name="sampleBlockRemark" label="样块备注" extra="多个样块共用一条备注；没有样块时选填" rules={[{ validator: (_, value) => ((files.sampleBlockAttachmentIds?.length ?? 0) + (savedAttachmentIds.sampleBlockAttachmentIds?.length ?? 0) === 0) || String(value ?? "").trim() ? Promise.resolve() : Promise.reject(new Error("上传客户样块时必须填写样块备注")) }]}><Input.TextArea rows={3} placeholder="填写样块颜色、材质、适用区域或客户确认说明" /></Form.Item>}
        {checklistItems.length > 0 && <Form.Item name="checklist" label="逐项审核（必须全部确认）" rules={[{ validator: (_, value) => Array.isArray(value) && value.length === checklistItems.length ? Promise.resolve() : Promise.reject(new Error("请逐项完成全部检查")) }]}><Checkbox.Group className="erp-review-checklist" options={checklistItems} /></Form.Item>}
        {checklistItems.length > 0 && <Form.Item name="comment" label="审核意见"><Input.TextArea rows={4} placeholder="记录判断依据、边界条件或需后续关注事项" /></Form.Item>}
      </div>}
      {!directSubmit && step === reviewStep && command === "SUBMIT_TECHNICAL" && <div className="erp-submit-review">
        <Alert type="success" showIcon title={`已引用 ${new Set((materialPreview?.lines ?? []).map((line) => line.templateType)).size} 类解析草稿，共 ${materialPreview?.lines.length ?? 0} 条有效物料；异常必须回到源Excel修正后重传。`} />
        <Table size="small" scroll={{ x: 1180, y: "max(120px, calc(100dvh - 440px))" }} pagination={{ pageSize: 8 }} rowKey={(line) => `${line.templateType}-${line.sourceRow}-${line.sourceSubRow}`} dataSource={materialPreview?.lines ?? []} rowClassName={(line) => line.needsManualReview ? "erp-material-warning-row" : ""} columns={[
          { title: "来源", width: 150, render: (_, line) => <div>{line.templateType}<small className="erp-subline">{line.sourceSheet} · {line.sourceRow}-{line.sourceSubRow}</small></div> },
          { title: "物料/规格", width: 220, render: (_, line) => <div><strong>{line.normalizedName}</strong><small className="erp-subline">{line.specification ?? line.rawName}</small></div> },
          { title: "实际", width: 110, render: (_, line) => `${line.actualQty} ${line.unit}` },
          { title: "采购数量", width: 150, render: (_, line) => `${Number(line.purchaseQty).toFixed(4)} ${line.unit}` },
          { title: "单位", width: 105, dataIndex: "unit" },
          { title: "类别", width: 325, dataIndex: "templateType", render: (value) => <Tag>{value}</Tag> },
          { title: "校验", width: 120, render: () => <Tag color="success">源表有效</Tag> },
        ]} />
      </div>}
      {!directSubmit && step === reviewStep && command !== "SUBMIT_TECHNICAL" && <div className="erp-submit-review"><Alert type={action?.danger ? "warning" : "success"} showIcon title={action?.danger ? "退回后订单会回到上一责任环节，已生成的生产编号不会改变。" : "提交后将原子更新订单阶段、负责人、下一任务、风险、门禁和操作记录。"} /><Descriptions bordered size="small" column={2} items={[
        { key: "order", label: "销售订单", children: order?.salesNumber ?? order?.trackingSerial }, { key: "action", label: "办理动作", children: action?.label },
        { key: "files", label: "附件", children: `${Object.values(files).reduce((sum, list) => sum + list.length, 0)} 个文件` }, { key: "checks", label: "检查项", children: checklistItems.length ? `${checklistItems.length} 项，需全部通过` : "按表单必填项校验" },
      ]} /></div>}
      </div>
      <Divider />
      <div className="erp-modal-actions">{directSubmit ? <>
        <Button disabled={saving || savingDraft} onClick={onCancel}>取消</Button>
        {command === "APPROVE_PRE_REVIEW" && <Button loading={savingDraft} disabled={saving} onClick={saveDraft}>保存当前进度</Button>}
        {command === "APPROVE_TECH_REVIEW" && <Button loading={savingDraft} disabled={saving} onClick={saveDraft}>保存当前进度</Button>}
        <Button type="primary" loading={saving} disabled={savingDraft} onClick={submit}>{directSubmitLabel}</Button>
      </> : <><Button onClick={step === 0 ? onCancel : () => setStep((value) => value - 1)}>{step === 0 ? "取消" : "上一步"}</Button>{command !== "SUBMIT_TECHNICAL" && <Button loading={savingDraft} onClick={saveDraft}>保存当前进度</Button>}{command === "SUBMIT_TECHNICAL" && step === reviewStep && <Button loading={savingDraft} disabled={saving} onClick={saveTechnicalAreaForBatch}>保存本区域，稍后批量提交</Button>}{step < reviewStep ? <Button type="primary" loading={command === "SUBMIT_TECHNICAL" && savingDraft} onClick={validateAndNext}>{command === "SUBMIT_TECHNICAL" ? step === 0 ? "填写当前区域资料" : "核对当前区域" : "下一步"}</Button> : <Button type="primary" danger={action?.danger} loading={saving} disabled={savingDraft} onClick={submit}>{command === "SUBMIT_TECHNICAL" ? "仅提交当前区域" : "确认提交并推进状态"}</Button>}</>}</div>
    </Form>
  </Modal>;
}

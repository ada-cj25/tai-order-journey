import { useEffect, useMemo, useState } from "react";
import { App as AntApp, Button, Card, Checkbox, Empty, Modal, Select, Space, Table, Tag, Upload } from "antd";
import type { RcFile } from "antd/es/upload";
import { RiDeleteBinLine, RiFileExcel2Line, RiRefreshLine, RiUpload2Line } from "@remixicon/react";

type ApiCall = <T>(path: string, init?: RequestInit) => Promise<T>;
type TemplateType = "HARDWARE_MATERIALS" | "PAINT_WOOD" | "SOLID_WOOD_DOOR" | "VENEER_DOOR";

type PreviewLine = {
  sourceFileName: string;
  sourceSheet: string;
  sourceRow: number;
  sourceSubRow: string;
  templateType: TemplateType;
  rawName: string;
  normalizedName: string;
  specification?: string | null;
  actualQty: number;
  purchaseQty: number;
  unit: string;
  calculationSource: string;
};

type PreviewIssue = { code: string; row: number; column?: string; message: string; rawValue?: string };
type PreviewBatch = {
  id: string;
  templateType: TemplateType;
  parserVersion: string;
  fingerprintVersion: string;
  sourceProductionNumber: string | null;
  valid: boolean;
  sourceAttachmentId: string;
  fileName: string;
  sheetName: string;
  lines: PreviewLine[];
  errors: PreviewIssue[];
  createdAt: string;
};

const TEMPLATES: Array<{ type: TemplateType; label: string; description: string }> = [
  { type: "HARDWARE_MATERIALS", label: "五金物料", description: "读取“物料单”的板材、封边、玻璃和五金配件区域" },
  { type: "PAINT_WOOD", label: "油漆门板 / 实木", description: "从“实木原材料生产下料单”开始读取，不读取上方油漆配方" },
  { type: "SOLID_WOOD_DOOR", label: "实木房门", description: "读取“下料单”的实木原材料生产下料单区域" },
  { type: "VENEER_DOOR", label: "饰面板房门", description: "读取包含平板门材质的“下料单”原材料区域" },
];

const TYPE_LABEL = Object.fromEntries(TEMPLATES.map((item) => [item.type, item.label])) as Record<TemplateType, string>;
const CALCULATION_LABEL: Record<string, string> = { SOURCE_VALUE: "来源表数量", CALCULATED: "系统损耗换算", MANUAL_REQUIRED: "需修正源表" };

export function MaterialImportWorkspace({ order, area, api }: { order: { id: string }; area: { id: string; name: string; productionNumber: string }; api: ApiCall }) {
  const { message } = AntApp.useApp();
  const [batches, setBatches] = useState<PreviewBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<TemplateType | null>(null);
  const [filter, setFilter] = useState<TemplateType | undefined>();
  const [errorsOnly, setErrorsOnly] = useState(false);

  async function load() {
    setLoading(true);
    try { setBatches(await api<PreviewBatch[]>(`/api/v1/material-imports/order/${order.id}/area/${area.id}/drafts`)); }
    catch (error) { message.error(error instanceof Error ? error.message : "物料解析草稿加载失败"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [order.id, area.id]);

  async function upload(type: TemplateType, file: RcFile) {
    setUploading(type);
    try {
      const body = new FormData();
      body.append("category", type);
      body.append("productionAreaId", area.id);
      body.append("file", file);
      const attachment = await api<{ id: string }>(`/api/v1/attachments/${order.id}`, { method: "POST", body });
      const preview = await api<PreviewBatch>("/api/v1/material-imports/preview", { method: "POST", body: JSON.stringify({ orderId: order.id, productionAreaId: area.id, attachmentId: attachment.id, templateType: type }) });
      setBatches((current) => [...current.filter((item) => item.templateType !== type), preview]);
      if (preview.valid) message.success(`${TYPE_LABEL[type]}已解析，共${preview.lines.length}条有效物料`);
      else message.warning(`${TYPE_LABEL[type]}发现${preview.errors.length}项问题，请修正源Excel后重新上传`);
    } catch (error) { message.error(error instanceof Error ? error.message : "上传解析失败"); }
    finally { setUploading(null); }
  }

  function cancel(batch: PreviewBatch) {
    Modal.confirm({
      title: `移除${TYPE_LABEL[batch.templateType]}解析草稿`,
      content: "本次解析将退出当前预览，原始附件和历史解析记录仍会保留。",
      okText: "确认移除",
      okButtonProps: { danger: true },
      onOk: async () => {
        await api(`/api/v1/material-imports/${batch.id}/cancel`, { method: "POST" });
        setBatches((current) => current.filter((item) => item.id !== batch.id));
        message.success("当前类别已移除");
      },
    });
  }

  const visibleBatches = useMemo(() => filter ? batches.filter((batch) => batch.templateType === filter) : batches, [batches, filter]);
  const previewLines = useMemo(() => errorsOnly ? [] : visibleBatches.flatMap((batch) => batch.lines), [visibleBatches, errorsOnly]);
  const issues = useMemo(() => visibleBatches.flatMap((batch) => batch.errors.map((issue, index) => ({ ...issue, key: `${batch.id}-${index}`, templateType: batch.templateType, fileName: batch.fileName, sheetName: batch.sheetName }))), [visibleBatches]);

  return <Card className="erp-panel erp-material-import" title={`${area.name} · ${area.productionNumber} · 物料单解析草稿`} extra={<Button size="small" icon={<RiRefreshLine />} onClick={() => void load()}>刷新</Button>}>
    <div className="erp-material-upload-grid">
      {TEMPLATES.map((template) => {
        const batch = batches.find((item) => item.templateType === template.type);
        const busy = uploading === template.type;
        return <section key={template.type} className={`erp-material-upload-slot ${batch?.valid ? "valid" : batch ? "invalid" : ""}`}>
          <div className="erp-material-upload-title"><RiFileExcel2Line /><div><strong>{template.label}</strong><small>{template.description}</small></div></div>
          {batch ? <>
            <div className="erp-material-file"><span title={batch.fileName}>{batch.fileName}</span><Tag color={busy ? "processing" : batch.valid ? "success" : "error"}>{busy ? "解析中" : batch.valid ? "有效" : "需修正"}</Tag></div>
            <div className="erp-material-file-meta"><span>生产编号 {batch.sourceProductionNumber ?? "未识别"}</span><span>{batch.lines.length}条物料 · {batch.errors.length}项错误</span></div>
          </> : busy ? <div className="erp-material-file"><span>正在读取Excel显示值</span><Tag color="processing">解析中</Tag></div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未上传，不影响其他类别" />}
          <Space>
            <Upload accept=".xls,.xlsx" maxCount={1} showUploadList={false} beforeUpload={(file) => { void upload(template.type, file); return Upload.LIST_IGNORE; }}>
              <Button size="small" type={batch ? "default" : "primary"} loading={busy} icon={<RiUpload2Line />}>{busy ? "解析中" : batch ? "重新上传" : "选择Excel"}</Button>
            </Upload>
            {batch && <Button size="small" danger icon={<RiDeleteBinLine />} onClick={() => cancel(batch)}>移除</Button>}
          </Space>
        </section>;
      })}
    </div>

    <div className="erp-compact-toolbar" role="group" aria-label="物料预览筛选">
      <Select allowClear placeholder="全部业务类别" value={filter} onChange={setFilter} style={{ width: 190 }} options={TEMPLATES.map((item) => ({ value: item.type, label: item.label }))} />
      <Checkbox checked={errorsOnly} onChange={(event) => setErrorsOnly(event.target.checked)}>仅看错误</Checkbox>
      <Tag color={batches.every((batch) => batch.valid) && batches.length ? "success" : batches.length ? "warning" : "default"}>{batches.length ? `${batches.filter((batch) => batch.valid).length}/${batches.length}类有效` : "尚未上传"}</Tag>
    </div>

    {!errorsOnly && <Table loading={loading} size="small" rowKey={(line) => `${line.templateType}-${line.sourceRow}-${line.sourceSubRow}`} dataSource={previewLines} pagination={{ pageSize: 8 }} scroll={{ x: 1200 }} locale={{ emptyText: "上传有效Excel后显示物料预览" }} columns={[
      { title: "类别 / 来源", width: 175, fixed: "left", render: (_, line) => <div><strong>{TYPE_LABEL[line.templateType]}</strong><small className="erp-subline">{line.sourceFileName}</small></div> },
      { title: "位置", width: 120, render: (_, line) => `${line.sourceSheet} · ${line.sourceRow}-${line.sourceSubRow}` },
      { title: "物料名称", dataIndex: "normalizedName", width: 190 },
      { title: "规格", dataIndex: "specification", width: 230, render: (value) => value || "—" },
      { title: "实际数量", width: 120, render: (_, line) => `${line.actualQty} ${line.unit}` },
      { title: "采购计价数量", width: 145, render: (_, line) => `${Number(line.purchaseQty).toFixed(4)} ${line.unit}` },
      { title: "计算依据", dataIndex: "calculationSource", width: 130, render: (value) => <Tag>{CALCULATION_LABEL[value] ?? value}</Tag> },
      { title: "状态", width: 90, render: () => <Tag color="success">有效</Tag> },
    ]} />}

    {issues.length > 0 && <Table size="small" rowKey="key" dataSource={issues} pagination={false} className="erp-material-errors" scroll={{ x: 920 }} columns={[
      { title: "类别 / 文件", width: 250, render: (_, issue) => <div><strong>{TYPE_LABEL[issue.templateType]}</strong><small className="erp-subline">{issue.fileName}</small></div> },
      { title: "位置", width: 130, render: (_, issue) => issue.row ? `${issue.sheetName} · ${issue.column ?? ""}${issue.row}` : issue.sheetName },
      { title: "问题", dataIndex: "message", width: 380 },
      { title: "源值", dataIndex: "rawValue", width: 160, render: (value) => value || "—" },
      { title: "处理", width: 140, render: () => <Tag color="error">修正Excel后重传</Tag> },
    ]} />}
  </Card>;
}

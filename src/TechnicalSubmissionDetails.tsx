import { Descriptions, Empty, Table, Tag, Typography } from "antd";

const TEMPLATE_LABELS: Record<string, string> = {
  HARDWARE_MATERIALS: "五金物料",
  PAINT_WOOD: "油漆门板 / 实木",
  SOLID_WOOD_DOOR: "实木房门",
  VENEER_DOOR: "饰面板房门",
};
const CALCULATION_LABELS: Record<string, string> = {
  SOURCE_VALUE: "来源表数量",
  CALCULATED: "系统损耗换算",
  MANUAL_REQUIRED: "需人工核对",
};

function display(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "—";
}

function quantity(value: unknown) {
  if (value == null || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("zh-CN", { maximumFractionDigits: 4, useGrouping: false }) : "—";
}

export function TechnicalSubmissionDetails({ payload }: { payload: Record<string, unknown> }) {
  const attachmentCount = (field: string) => Array.isArray(payload[field]) ? payload[field].length : 0;
  const lines = Array.isArray(payload.materialLines)
    ? payload.materialLines.filter((line): line is Record<string, unknown> => Boolean(line) && typeof line === "object" && !Array.isArray(line)).map((line, index) => ({ ...line, key: index }))
    : [];

  return <>
    <Descriptions className="erp-technical-summary" bordered size="small" column={2} items={[
      { key: "version", label: "对应设计版本", children: display(payload.designVersion) },
      { key: "rows", label: "提交物料行数", children: `${lines.length} 条` },
      { key: "haixun-files", label: "海迅单", children: `${attachmentCount("haixunAttachmentIds")} 个文件` },
      { key: "decomposition-files", label: "分解单", children: `${attachmentCount("decompositionAttachmentIds")} 个文件` },
      { key: "panel", label: "板式计划面积", children: `${quantity(payload.panelQty)} ㎡` },
      { key: "wood", label: "木工计划面积", children: `${quantity(payload.woodQty)} ㎡` },
      { key: "veneer", label: "贴皮工序", children: payload.woodPaintEnabled === true ? payload.veneerRequired === true ? "需要（与制作2并行）" : "不需要" : "不适用" },
      { key: "paint", label: "油漆计划面积", children: `${quantity(payload.paintQty)} ㎡` },
      { key: "assembly", label: "组装计划面积", children: `${quantity(payload.assemblyQty)} ㎡` },
      { key: "summary", label: "校验结果摘要", span: 2, children: display(payload.validationSummary) },
    ]} />
    <section className="erp-submission-materials">
      <Typography.Title level={5}>提交物料明细</Typography.Title>
      <Typography.Paragraph type="secondary">本次提交保存的物料快照，共 {lines.length} 条。</Typography.Paragraph>
      <Table<Record<string, unknown>> size="small" rowKey={(line) => String(line.key)} dataSource={lines} pagination={{ pageSize: 8, showSizeChanger: false }} scroll={{ x: 1450, y: 280 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该提交记录暂无结构化物料明细，请核对原始附件" /> }} columns={[
        { title: "物料名称", width: 180, fixed: "left", ellipsis: true, render: (_, line) => display(line.normalizedName ?? line.rawName ?? line.name) },
        { title: "业务类别", width: 150, render: (_, line) => TEMPLATE_LABELS[String(line.templateType)] ?? "未标明类别" },
        { title: "规格", width: 260, ellipsis: true, render: (_, line) => display(line.specification ?? line.rawSpecification) },
        { title: "实际数量", width: 110, render: (_, line) => quantity(line.actualQty) },
        { title: "采购计价数量", width: 130, render: (_, line) => quantity(line.purchaseQty) },
        { title: "单位", width: 70, render: (_, line) => display(line.unit) },
        { title: "计算依据", width: 130, render: (_, line) => CALCULATION_LABELS[String(line.calculationSource)] ?? "待核对" },
        { title: "来源文件", width: 170, ellipsis: true, render: (_, line) => display(line.sourceFileName) },
        { title: "原表位置", width: 140, render: (_, line) => `${display(line.sourceSheet)} · ${display(line.sourceRow)}${line.sourceSubRow ? `-${display(line.sourceSubRow)}` : ""}` },
        { title: "解析状态", width: 110, fixed: "right", render: (_, line) => <Tag color={line.needsManualReview ? "warning" : "success"}>{line.needsManualReview ? "需核对" : "已解析"}</Tag> },
      ]} />
    </section>
  </>;
}

import { useEffect, useState } from "react";
import { Alert, App as AntApp, Button, Card, Checkbox, Empty, Form, Input, InputNumber, Select, Space, Table } from "antd";

type ApiCall = <T>(path: string, init?: RequestInit) => Promise<T>;
type Line = { presetCode?: string | null; name: string; plannedQty: number; unit: string; usageArea?: string | null; note?: string | null };
type Draft = { id: string; version: number; declaresNone: boolean; lines: Array<Line & { id: string }> } | null;

const PRESETS = ["铝框玻璃门", "铝蜂窝柜", "涂料门", "外购爱格门"];

export function OutsourceRequirementEditor({ orderId, updatedAt, mode, api, onSaved }: { orderId: string; updatedAt?: string; mode?: string; api: ApiCall; onSaved: () => Promise<void> }) {
  const { message } = AntApp.useApp();
  const [draft, setDraft] = useState<Draft>(null);
  const [declaresNone, setDeclaresNone] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<Draft>(`/api/v1/orders/${orderId}/outsource/draft`).then((value) => {
      setDraft(value);
      setDeclaresNone(Boolean(value?.declaresNone));
      setLines((value?.lines ?? []).map((line) => ({ ...line, plannedQty: Number(line.plannedQty), unit: line.unit || "件" })));
    }).catch(() => undefined);
  }, [api, orderId]);

  if (mode === "LEGACY_EXEMPT" && !draft) return <Card title="订单级外购成品清单" className="erp-panel"><Alert type="info" showIcon title="历史订单已豁免新外购声明" description="继续按原有流程执行，系统不会根据旧字段伪造外购到货或发货事实。" /></Card>;

  function addLine(name = "") {
    setDeclaresNone(false);
    setLines((current) => [...current, { presetCode: PRESETS.includes(name) ? name : null, name, plannedQty: 1, unit: "件", usageArea: "", note: "" }]);
  }

  async function save() {
    setSaving(true);
    try {
      await api(`/api/v1/orders/${orderId}/outsource/draft`, { method: "POST", headers: { "x-expected-updated-at": updatedAt ?? "" }, body: JSON.stringify({ declaresNone, lines: declaresNone ? [] : lines }) });
      message.success("外购成品声明已保存，将随整单拆单一起提交复核");
      await onSaved();
    } catch (error) { message.error(error instanceof Error ? error.message : "保存失败"); }
    finally { setSaving(false); }
  }

  return <Card title="订单级外购成品清单" className="erp-panel">
    <Checkbox style={{ marginBottom: 16 }} checked={declaresNone} onChange={(event) => { setDeclaresNone(event.target.checked); if (event.target.checked) setLines([]); }}>本订单无外购成品</Checkbox>
    {!declaresNone && <>
      <Space wrap style={{ marginBottom: 12 }}><span>快速添加：</span>{PRESETS.map((name) => <Button key={name} size="small" onClick={() => addLine(name)}>{name}</Button>)}<Button size="small" onClick={() => addLine()}>其他外购产品</Button></Space>
      <Table pagination={false} rowKey={(_, index) => String(index)} dataSource={lines} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请添加外购产品，或勾选无外购成品" /> }} columns={[
        { title: "产品名称", width: 210, render: (_, _line, index) => <Select showSearch value={lines[index]?.name} options={PRESETS.map((value) => ({ value, label: value }))} onChange={(value) => setLines((current) => current.map((line, i) => i === index ? { ...line, name: value, presetCode: value } : line))} dropdownRender={(menu) => <>{menu}<div style={{ padding: 8 }}><Input placeholder="输入自定义产品名称" onPressEnter={(event) => { const value = event.currentTarget.value.trim(); if (value) setLines((current) => current.map((line, i) => i === index ? { ...line, name: value, presetCode: null } : line)); }} /></div></>} style={{ width: "100%" }} /> },
        { title: "计划数量", width: 135, render: (_, _line, index) => <InputNumber min={1} precision={0} value={lines[index]?.plannedQty} addonAfter="件" onChange={(value) => setLines((current) => current.map((line, i) => i === index ? { ...line, plannedQty: Number(value ?? 0) } : line))} /> },
        { title: "使用区域（选填）", width: 170, render: (_, _line, index) => <Input value={lines[index]?.usageArea ?? ""} placeholder="例如：客厅" onChange={(event) => setLines((current) => current.map((line, i) => i === index ? { ...line, usageArea: event.target.value } : line))} /> },
        { title: "备注（选填）", render: (_, _line, index) => <Input value={lines[index]?.note ?? ""} onChange={(event) => setLines((current) => current.map((line, i) => i === index ? { ...line, note: event.target.value } : line))} /> },
        { title: "操作", width: 80, render: (_, _line, index) => <Button danger size="small" onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>删除</Button> },
      ]} />
    </>}
    <div style={{ marginTop: 16, textAlign: "right" }}><Button type="primary" loading={saving} onClick={save}>保存外购声明</Button></div>
  </Card>;
}

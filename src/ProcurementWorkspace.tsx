import { useMemo, useState } from "react";
import { App as AntApp, Alert, Button, Card, Checkbox, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { formatUnitCost } from "./cost-format";

type ApiCall = <T>(path: string, init?: RequestInit) => Promise<T>;
type Employee = { role: string; costModuleEnabled?: boolean };
type Row = Record<string, any>;

const PROCUREMENT_STATUS: Record<string, { label: string; color: string }> = {
  NOT_STARTED: { label: "待进入采购", color: "default" },
  PENDING: { label: "待采购", color: "processing" },
  DUE_SOON: { label: "临期", color: "warning" },
  OVERDUE: { label: "已延期", color: "error" },
  COMPLETED_ON_TIME: { label: "按时完成", color: "success" },
  COMPLETED_LATE: { label: "延期完成", color: "volcano" },
};

const COST_STATUS: Record<string, { label: string; color: string }> = {
  NOT_PARSED: { label: "待解析", color: "default" },
  WAITING_PRICE: { label: "待补单价", color: "warning" },
  WAITING_OUTSOURCE_PRICE: { label: "外购待定价", color: "warning" },
  INSTALLATION_PENDING: { label: "待安装归集", color: "processing" },
  COMPLETE: { label: "已核算", color: "success" },
  FINANCE_MANAGED: { label: "由财务核算", color: "default" },
};

const STAGE_LABELS: Record<string, string> = {
  DEPOSIT_PENDING: "签订合同", DESIGN_PENDING: "设计下单", DESIGN_ACCEPTED: "设计提交",
  PRE_REVIEW: "前置审单", TECHNICAL: "技术拆单", TECH_REVIEW: "技术审单",
  MATERIALS: "物料采购", PRODUCTION: "四车间生产", INSTALLATION_APPLICATION: "发货", DELIVERY: "发货",
  INSTALLATION: "安装", ACCEPTANCE: "客户验收", BUSINESS_COMPLETE: "履约完成",
};

function money(value: unknown) {
  if (value == null) return "—";
  return `¥${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusTag(value: string, map: Record<string, { label: string; color: string }>) {
  const item = map[value] ?? { label: value || "—", color: "default" };
  return <Tag color={item.color}>{item.label}</Tag>;
}

export function ProcurementWorkspace({ employee, api, data, loading, refresh, openOrder }: { employee: Employee; api: ApiCall; data: Row; loading: boolean; refresh: () => Promise<void>; openOrder: (id: string) => void }) {
  const { message } = AntApp.useApp();
  const [search, setSearch] = useState("");
  const [procurementFilter, setProcurementFilter] = useState<string>();
  const [costFilter, setCostFilter] = useState<string>();
  const [pricingItem, setPricingItem] = useState<Row | null>(null);
  const [rateItem, setRateItem] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [rateForm] = Form.useForm();
  const [arrivalForm] = Form.useForm();
  const [arrivalLine, setArrivalLine] = useState<Row | null>(null);
  const orders: Row[] = data.orders ?? [];
  const costItems: Row[] = data.costItems ?? [];
  const workshopRates: Row[] = data.workshopRates ?? [];
  const canManageCost = Boolean(employee.costModuleEnabled) && ["FINANCE", "CHAIRMAN"].includes(employee.role);
  const canEditPrice = canManageCost;
  const canConfirmArrival = ["ORDER_ADMIN", "CHAIRMAN"].includes(employee.role);
  const canConfirmProcurement = ["PROCUREMENT", "CHAIRMAN"].includes(employee.role);
  const outsourceLines = useMemo(() => orders.flatMap((order) => (order.outsourceRequirement?.lines ?? []).map((line: Row) => {
    const activeArrivals = (line.arrivals ?? []).filter((arrival: Row) => !arrival.voidedAt);
    const arrivedQty = activeArrivals.reduce((sum: number, arrival: Row) => sum + Number(arrival.quantity), 0);
    const plannedQty = Number(line.plannedQty);
    return { ...line, order, activeArrivals, arrivedQty, remainingQty: Math.max(0, plannedQty - arrivedQty), status: line.shipmentLine ? "SHIPPED" : arrivedQty <= 0 ? "NOT_ARRIVED" : arrivedQty < plannedQty ? "PARTIAL" : "READY" };
  })), [orders]);

  const filteredOrders = useMemo(() => orders.filter((order) => {
    const keyword = search.trim().toLowerCase();
    const areaText = (order.productionAreas ?? []).map((area: Row) => `${area.name ?? ""} ${area.productionNumber ?? ""}`).join(" ");
    const text = `${order.salesNumber ?? ""} ${order.trackingSerial ?? ""} ${areaText} ${order.customerName ?? ""} ${order.address ?? ""}`.toLowerCase();
    return (!keyword || text.includes(keyword))
      && (!procurementFilter || order.procurementStatus === procurementFilter)
      && (!costFilter || order.costStatus === costFilter);
  }), [orders, search, procurementFilter, costFilter]);

  async function savePrice() {
    if (!pricingItem) return;
    const values = await form.validateFields();
    setSaving(true);
    try {
      await api(`/api/v1/material-cost-items/${pricingItem.id}/prices`, { method: "POST", body: JSON.stringify(values) });
      message.success("单位成本已建立新版本，相关待定价订单已自动核算");
      setPricingItem(null);
      form.resetFields();
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "单位成本保存失败");
      throw error;
    } finally { setSaving(false); }
  }

  async function saveWorkshopRate() {
    if (!rateItem) return;
    const values = await rateForm.validateFields();
    setSaving(true);
    try {
      await api(`/api/v1/workshop-cost-rates/${rateItem.workshop}/prices`, { method: "POST", body: JSON.stringify(values) });
      message.success("车间综合单价已建立新版本；已发布订单继续使用原快照");
      setRateItem(null); rateForm.resetFields(); await refresh();
    } catch (error) { message.error(error instanceof Error ? error.message : "车间综合单价保存失败"); throw error; }
    finally { setSaving(false); }
  }

  function completeProcurementRoute(order: Row, gate: Row, area?: Row) {
    let attested = false;
    const label = gate.kind === "PANEL" ? "板式路线" : "实木油漆路线";
    const pendingAreas = (gate.routes ?? []).filter((route: Row) => !route.releasedAt).map((route: Row) => route.productionArea);
    const scope = area ? `${area.name} · ${area.productionNumber}` : `${pendingAreas.length} 个待确认区域`;
    Modal.confirm({ title: area ? `确认${scope}的${label}采购完成` : `一键确认全部${label}采购完成`, okText: area ? "确认并开放该区域" : "确认并批量开放", content: <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 12 }}><Descriptions size="small" bordered column={1} items={[{ key: "scope", label: "确认范围", children: area ? scope : <div><div>{scope}</div><ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>{pendingAreas.map((candidate: Row) => <li key={candidate.id}>{candidate.name} · {candidate.productionNumber}</li>)}</ul></div> }, { key: "due", label: "采购截止", children: dayjs(gate.dueAt).format("YYYY-MM-DD HH:mm") }]} /><Checkbox onChange={(event) => { attested = event.target.checked; }}>已在线下完成上述{label}采购</Checkbox></Space>, onOk: async () => {
      if (!attested) { message.error("请先勾选完成声明"); return Promise.reject(); }
      try { await api(`/api/v1/orders/${order.id}/procurement-routes/${gate.kind}/complete`, { method: "POST", headers: { "x-expected-updated-at": order.updatedAt }, body: JSON.stringify({ attested: true, ...(area ? { productionAreaId: area.id } : {}) }) }); await refresh(); message.success(area ? `${scope}的${label}已开放` : `全部待确认${label}已开放`); }
      catch (error) { message.error(error instanceof Error ? error.message : "路线采购确认失败"); return Promise.reject(error); }
    } });
  }

  const orderPage = <Card className="erp-table-card">
    <div className="erp-compact-toolbar erp-procurement-filters" role="group" aria-label="订单筛选">
      <Input.Search allowClear placeholder="搜索销售编号、跟单号、区域生产编号、客户或项目" value={search} onChange={(event) => setSearch(event.target.value)} />
      <Select allowClear placeholder="采购状态" value={procurementFilter} onChange={setProcurementFilter} options={Object.entries(PROCUREMENT_STATUS).map(([value, item]) => ({ value, label: item.label }))} />
      {employee.costModuleEnabled && <Select allowClear placeholder="成本状态" value={costFilter} onChange={setCostFilter} options={Object.entries(COST_STATUS).map(([value, item]) => ({ value, label: item.label }))} />}
    </div>
    <Table loading={loading} rowKey="id" dataSource={filteredOrders} scroll={{ x: 1480 }} pagination={{ pageSize: 12 }} onRow={(row) => ({ onClick: () => openOrder(row.id), style: { cursor: "pointer" } })} expandable={{ expandedRowRender: (order: Row) => order.procurementRoutes?.length ? <Space direction="vertical" size={12} style={{ width: "100%" }}>{order.procurementRoutes.map((gate: Row) => { const pendingRoutes = (gate.routes ?? []).filter((route: Row) => !route.releasedAt); return <div key={gate.id}><div className="erp-procurement-route-heading"><strong>{gate.kind === "PANEL" ? "板式路线" : "实木油漆路线"}</strong><Space><Tag color={pendingRoutes.length ? "processing" : "success"}>{(gate.routes?.length ?? 0) - pendingRoutes.length}/{gate.routes?.length ?? 0} 区域完成</Tag>{canConfirmProcurement && pendingRoutes.length > 1 && <Button size="small" onClick={(event) => { event.stopPropagation(); completeProcurementRoute(order, gate); }}>一键确认全部</Button>}</Space></div><div className="erp-procurement-route-grid">{(gate.routes ?? []).map((route: Row) => <section key={route.id} className="erp-procurement-route-card" onClick={(event) => event.stopPropagation()}><div><strong>{route.productionArea.name} · {route.productionArea.productionNumber}</strong><Tag color={route.releasedAt ? "success" : "warning"}>{route.releasedAt ? "已完成" : "待确认"}</Tag></div><small>截止 {dayjs(gate.dueAt).format("YYYY-MM-DD HH:mm")}{route.releasedAt ? ` · 完成 ${dayjs(route.releasedAt).format("YYYY-MM-DD HH:mm")}` : ""}</small>{!route.releasedAt && canConfirmProcurement && <Button size="small" type="primary" onClick={() => completeProcurementRoute(order, gate, route.productionArea)}>确认该区域采购完成</Button>}</section>)}</div></div>; })}</Space> : <Typography.Text type="secondary">历史订单使用整单采购确认</Typography.Text> }} columns={[
      { title: "销售编号 / 跟单号", width: 210, fixed: "left" as const, render: (_: unknown, row: Row) => <div className="erp-number"><strong>{row.salesNumber ?? row.trackingSerial}</strong><small>{row.salesNumber ? `${row.trackingSerial} · ${row.customerName}` : `待生成销售编号 · ${row.customerName}`}</small></div> },
      { title: "生产区域 / 生产编号", width: 250, render: (_: unknown, row: Row) => <Space size={[4, 4]} wrap>{(row.productionAreas ?? []).map((area: Row) => <Tag key={area.id}>{area.name} · {area.productionNumber}</Tag>)}</Space> },
      { title: "客户 / 项目", width: 220, render: (_: unknown, row: Row) => <div><strong>{row.customerName}</strong><small className="erp-subline">{row.address}</small></div> },
      { title: "订单类型", dataIndex: "businessTypeLabel", width: 130 },
      { title: "当前节点", dataIndex: "stage", width: 120, render: (value: string) => <Tag color="cyan">{STAGE_LABELS[value] ?? value}</Tag> },
      { title: "采购开始", dataIndex: "procurementStartedAt", width: 150, render: (value: string) => value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—" },
      { title: "采购截止", dataIndex: "procurementDueAt", width: 150, render: (value: string) => value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—" },
      { title: "采购完成", dataIndex: "procurementCompletedAt", width: 150, render: (value: string) => value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—" },
      { title: "采购状态", dataIndex: "procurementStatus", width: 110, render: (value: string) => statusTag(value, PROCUREMENT_STATUS) },
      { title: "路线进度", width: 120, render: (_: unknown, row: Row) => row.procurementRoutes?.length ? (() => { const routes = row.procurementRoutes.flatMap((gate: Row) => gate.routes ?? []); const completed = routes.filter((route: Row) => route.releasedAt).length; return <Tag color={routes.length > 0 && completed === routes.length ? "success" : "processing"}>{completed}/{routes.length}</Tag>; })() : <Tag>整单旧模式</Tag> },
      ...(employee.costModuleEnabled ? [{ title: "成本状态", dataIndex: "costStatus", width: 120, render: (value: string, row: Row) => <Space size={4}>{statusTag(value, COST_STATUS)}{row.missingPriceCount ? <Typography.Text type="warning">⚠ {row.missingPriceCount}</Typography.Text> : null}{row.missingOutsourcePriceCount ? <Typography.Text type="warning">外购 {row.missingOutsourcePriceCount}</Typography.Text> : null}</Space> }] : []),
      ...(canManageCost ? [{ title: "成本金额", width: 160, render: (_: unknown, row: Row) => row.costTotal != null ? <strong>{money(row.costTotal)} 总额</strong> : row.costStatus === "NOT_PARSED" ? "—" : <span>{money(row.costSubtotal)} 已知小计</span> }] : []),
      { title: "当前负责人", dataIndex: "currentOwnerLabel", width: 130 },
      { title: "操作", width: 90, fixed: "right" as const, render: (_: unknown, row: Row) => <Button size="small" onClick={(event) => { event.stopPropagation(); openOrder(row.id); }}>查看</Button> },
    ]} />
  </Card>;

  const costPage = <Space direction="vertical" size={16} style={{ width: "100%" }}><Card title="车间综合单价" className="erp-table-card">
    <Table size="small" pagination={false} rowKey="workshop" dataSource={workshopRates} expandable={{ expandedRowRender: (row: Row) => <Table size="small" pagination={false} rowKey="id" dataSource={row.priceVersions ?? []} columns={[
      { title: "版本", dataIndex: "version", render: (value: number) => `W${value}` },
      { title: "综合单价", dataIndex: "unitPrice", render: (value: unknown) => `${formatUnitCost(value)} / ㎡` },
      { title: "生效时间", dataIndex: "effectiveAt", render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm") },
      { title: "说明", dataIndex: "note", render: (value: string) => value || "—" },
    ]} /> }} columns={[
      { title: "车间", dataIndex: "workshopLabel" },
      { title: "当前综合单价", dataIndex: "currentPrice", render: (value: unknown) => value == null ? <Typography.Text type="warning">待配置</Typography.Text> : `${formatUnitCost(value)} / ㎡` },
      { title: "操作", width: 190, render: (_: unknown, row: Row) => <Button size="small" onClick={() => { setRateItem(row); rateForm.setFieldsValue({ unitPrice: row.currentPrice ?? undefined, note: "" }); }}>建立新单价版本</Button> },
    ]} />
  </Card><Card title="物料单位成本" className="erp-table-card erp-cost-table-card">
    <Table className="erp-cost-table" loading={loading} rowKey="id" dataSource={costItems} pagination={{ pageSize: 15 }} scroll={{ x: 1320 }} sticky={{ offsetHeader: 64, offsetScroll: 10 }} expandable={{ expandedRowRender: (row: Row) => <Table className="erp-cost-history-table" size="small" rowKey="id" pagination={false} scroll={{ x: 820 }} dataSource={row.priceVersions ?? []} locale={{ emptyText: "尚未录入价格" }} columns={[
      { title: "价格版本", dataIndex: "version", width: 100, render: (value: number) => `P${value}` },
      { title: "单位成本", dataIndex: "unitPrice", width: 130, render: formatUnitCost },
      { title: "生效时间", dataIndex: "effectiveAt", width: 170, render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm") },
      { title: "备注", dataIndex: "note", width: 420, render: (value: string) => value || "—" },
    ]} /> }} columns={[
      { title: "物料名称", dataIndex: "normalizedName", width: 160, fixed: "left", render: (value: string, row: Row) => <Space>{row.status === "WAITING_PRICE" && <span aria-label="待定价">⚠️</span>}<strong>{value}</strong></Space> },
      { title: "规格型号", dataIndex: "specification", width: 170, render: (value: string) => value || "—" },
      { title: "单位", dataIndex: "unit", width: 75 },
      { title: "当前单位成本", dataIndex: "currentPrice", width: 135, render: (value: unknown) => value == null ? <Typography.Text type="warning">请添加单价</Typography.Text> : formatUnitCost(value) },
      { title: "状态", dataIndex: "status", width: 105, render: (value: string) => statusTag(value, COST_STATUS) },
      { title: "引用订单数", dataIndex: "referenceCount", width: 105 },
      { title: "首次发现来源", dataIndex: "firstSource", width: 210, ellipsis: true },
      { title: "最近调价", dataIndex: "lastPriceAt", width: 165, render: (value: string) => value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—" },
      { title: "操作", width: 195, fixed: "right", render: (_: unknown, row: Row) => canEditPrice ? <Button type={row.status === "WAITING_PRICE" ? "primary" : "default"} size="small" onClick={() => { setPricingItem(row); form.setFieldsValue({ unitPrice: row.currentPrice ?? undefined, note: "" }); }}>{row.status === "WAITING_PRICE" ? "添加单价" : "建立新价格版本"}</Button> : <Tag>只读</Tag> },
    ]} />
  </Card></Space>;

  async function saveArrival() {
    if (!arrivalLine) return;
    const values = await arrivalForm.validateFields();
    setSaving(true);
    try {
      await api(`/api/v1/orders/${arrivalLine.order.id}/outsource/products/${arrivalLine.id}/arrivals`, { method: "POST", headers: { "x-expected-updated-at": arrivalLine.order.updatedAt }, body: JSON.stringify({ quantity: values.quantity, arrivedOn: values.arrivedOn.format("YYYY-MM-DD") }) });
      message.success("外购成品到货已登记");
      setArrivalLine(null); arrivalForm.resetFields(); await refresh();
    } catch (error) { message.error(error instanceof Error ? error.message : "到货登记失败"); }
    finally { setSaving(false); }
  }

  function voidArrival(row: Row, arrival: Row) {
    let reason = "";
    Modal.confirm({ title: `作废到货记录 · ${row.name}`, okText: "确认作废", okButtonProps: { danger: true }, content: <Input.TextArea style={{ marginTop: 12 }} rows={3} placeholder="作废原因（必填）" onChange={(event) => { reason = event.target.value; }} />, onOk: async () => {
      if (!reason.trim()) { message.error("请填写作废原因"); return Promise.reject(); }
      try { await api(`/api/v1/orders/${row.order.id}/outsource/arrivals/${arrival.id}/void`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) }); await refresh(); message.success("到货记录已作废"); }
      catch (error) { message.error(error instanceof Error ? error.message : "作废失败"); return Promise.reject(error); }
    } });
  }

  const outsourcePage = <Card className="erp-table-card">
    <Table loading={loading} rowKey="id" dataSource={outsourceLines} pagination={{ pageSize: 12 }} scroll={{ x: 1180 }} expandable={{ expandedRowRender: (row: Row) => <Table size="small" pagination={false} rowKey="id" dataSource={row.activeArrivals} locale={{ emptyText: "尚无到货记录" }} columns={[
      { title: "实际到货日期", dataIndex: "arrivedOn", render: (value: string) => dayjs(value).format("YYYY-MM-DD") },
      { title: "本次到货", render: (_: unknown, arrival: Row) => `${Number(arrival.quantity)} ${row.unit}` },
      { title: "操作", width: 100, render: (_: unknown, arrival: Row) => canConfirmArrival && !row.shipmentLine ? <Button size="small" danger onClick={() => voidArrival(row, arrival)}>作废</Button> : "—" },
    ]} /> }} columns={[
      { title: "销售编号 / 客户", width: 190, fixed: "left", render: (_: unknown, row: Row) => <div><strong>{row.order.salesNumber ?? row.order.trackingSerial}</strong><small className="erp-subline">{row.order.customerName}</small></div> },
      { title: "外购产品", width: 190, render: (_: unknown, row: Row) => <div><strong>{row.name}</strong><small className="erp-subline">{row.usageArea || "整单"}</small></div> },
      { title: "计划数量", width: 110, render: (_: unknown, row: Row) => `${Number(row.plannedQty)} ${row.unit}` },
      { title: "累计到货", width: 120, render: (_: unknown, row: Row) => `${row.arrivedQty} / ${Number(row.plannedQty)} ${row.unit}` },
      { title: "到货状态", width: 120, render: (_: unknown, row: Row) => <Tag color={row.status === "SHIPPED" ? "success" : row.status === "READY" ? "cyan" : row.status === "PARTIAL" ? "warning" : "default"}>{row.status === "SHIPPED" ? "已发货" : row.status === "READY" ? "已齐套" : row.status === "PARTIAL" ? "部分到货" : "未到货"}</Tag> },
      { title: "备注", dataIndex: "note", width: 190, render: (value: string) => value || "—" },
      { title: "操作", width: 110, fixed: "right", render: (_: unknown, row: Row) => canConfirmArrival && row.remainingQty > 0 && !row.shipmentLine ? <Button size="small" type="primary" onClick={() => { setArrivalLine(row); arrivalForm.setFieldsValue({ quantity: row.remainingQty }); }}>登记到货</Button> : <Button size="small" onClick={() => openOrder(row.order.id)}>查看订单</Button> },
    ]} />
  </Card>;

  return <div className="erp-module-page">
    <div className="erp-page-title"><div><Typography.Title level={2}>{employee.costModuleEnabled ? "采购与成本" : "采购登记"}</Typography.Title><p>{employee.costModuleEnabled ? "采购过程在线下完成；订单成本由物料单、车间、安装、外购成品和售后独立归集" : "采购过程在线下完成；系统记录交期完成事实。成本模块尚未开放，不阻断生产。"}</p></div></div>
    <Tabs items={[
      { key: "orders", label: `全部订单 ${orders.length}`, children: orderPage },
      { key: "outsource", label: `外购成品到货 ${outsourceLines.filter((line) => line.status !== "SHIPPED").length}`, children: outsourcePage },
      ...(canManageCost ? [{ key: "cost", label: `成本管理 ${costItems.filter((item) => item.status === "WAITING_PRICE").length} 项物料待定价`, children: costPage }] : []),
    ]} />
    <Modal title={`${pricingItem?.status === "WAITING_PRICE" ? "添加" : "更新"}单位成本 · ${pricingItem?.normalizedName ?? ""}`} open={Boolean(pricingItem)} onCancel={() => { setPricingItem(null); form.resetFields(); }} onOk={savePrice} okText="保存为新价格版本" confirmLoading={saving}>
      <Typography.Paragraph type="secondary">成本键：{pricingItem?.normalizedName}＋{pricingItem?.specification || "无规格"}＋{pricingItem?.unit}。价格保存后不会覆盖历史订单快照。</Typography.Paragraph>
      <Form form={form} layout="vertical">
        <Form.Item name="unitPrice" label={`人民币最终单位成本（元/${pricingItem?.unit ?? "单位"}）`} rules={[{ required: true, message: "请输入单位成本" }]}><InputNumber min={0.0001} precision={4} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="note" label="调价说明"><Input.TextArea rows={3} placeholder="首次定价或本次调价原因" /></Form.Item>
      </Form>
    </Modal>
    <Modal title={`建立车间综合单价版本 · ${rateItem?.workshopLabel ?? ""}`} open={Boolean(rateItem)} onCancel={() => { setRateItem(null); rateForm.resetFields(); }} onOk={saveWorkshopRate} okText="保存为新版本" confirmLoading={saving}>
      <Typography.Paragraph type="secondary">新价格只用于之后完成技术审单的订单；已发布订单继续使用原价格快照。</Typography.Paragraph>
      <Form form={rateForm} layout="vertical"><Form.Item name="unitPrice" label="综合单价（元/㎡）" rules={[{ required: true }]}><InputNumber min={0.0001} precision={4} style={{ width: "100%" }} /></Form.Item><Form.Item name="note" label="调价说明"><Input.TextArea rows={3} /></Form.Item></Form>
    </Modal>
    <Modal title={`登记外购到货 · ${arrivalLine?.name ?? ""}`} open={Boolean(arrivalLine)} onCancel={() => { setArrivalLine(null); arrivalForm.resetFields(); }} onOk={saveArrival} okText="确认到货" confirmLoading={saving}>
      <Typography.Paragraph type="secondary">计划 {arrivalLine ? Number(arrivalLine.plannedQty) : 0} {arrivalLine?.unit}，已到 {arrivalLine?.arrivedQty ?? 0} {arrivalLine?.unit}，本次最多可登记 {arrivalLine?.remainingQty ?? 0} {arrivalLine?.unit}。</Typography.Paragraph>
      <Form form={arrivalForm} layout="vertical"><Form.Item name="quantity" label="本次到货数量" rules={[{ required: true }]}><InputNumber min={1} max={arrivalLine?.remainingQty} precision={0} addonAfter={arrivalLine?.unit ?? "件"} style={{ width: "100%" }} /></Form.Item><Form.Item name="arrivedOn" label="实际到货日期" rules={[{ required: true }]}><DatePicker format="YYYY-MM-DD" needConfirm={false} style={{ width: "100%" }} /></Form.Item></Form>
    </Modal>
  </div>;
}

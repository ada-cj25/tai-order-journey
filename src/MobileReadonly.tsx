import { useMemo, useState } from "react";
import { Alert, Button, Card, Empty, Input, Skeleton, Space, Tag, Typography } from "antd";
import {
  RiAlarmWarningLine,
  RiArrowLeftLine,
  RiFileCopy2Line,
  RiLogoutBoxRLine,
  RiRefreshLine,
  RiSearchLine,
  RiShieldCheckLine,
  RiTimeLine,
  RiUserFollowLine,
} from "@remixicon/react";
import "./mobile.css";

type MobileEmployee = { name: string; role: string; department: string };
type MobileRisk = { id: string; title: string; description: string; impact: string; responsible: string; resolutionLabel: string };
type MobileOrder = {
  id: string;
  trackingSerial: string;
  salesNumber?: string | null;
  productionNumber?: string | null;
  customerName: string;
  address: string;
  businessTypeLabel: string;
  stage: string;
  stageLabel?: string;
  creationMode?: "SALES_STANDARD" | "INTERNAL_EXCEPTION";
  creationModeLabel?: string;
  chargeModeLabel?: string;
  currentOwnerLabel: string;
  nextAction: string;
  riskCount: number;
  afterSalesActive?: boolean;
  afterSalesCount?: number;
  risks?: MobileRisk[];
  promisedAt: string;
  internalDueAt: string;
  currentTask?: { dueAt: string; status: string; delayDays: number } | null;
  shipmentGate?: { allowed: boolean; tailPaymentConfirmed: boolean; installationApplied: boolean };
  fulfillmentTracks?: {
    manufactured: { allProductionAreasComplete: boolean; shipped: boolean; allowed: boolean };
    outsourced: {
      mode: string;
      applicable: boolean;
      allShipped: boolean;
      shippedCount: number;
      readyCount: number;
      lines: Array<{ id: string; name: string; plannedQty: number; arrivedQty: number; unit: string; status: string }>;
    };
    installationCompletionAllowed: boolean;
  };
  sales?: { name: string };
  designer?: { name: string } | null;
};
type TimelineItem = { id: string; title: string; description: string; createdAt: string; actor?: { name: string } };
type ApiCall = <T>(path: string, init?: RequestInit) => Promise<T>;
type FilingConfig = { icpFilingNumber?: string | null; publicSecurityFilingNumber?: string | null; publicSecurityFilingUrl?: string | null };

const STAGES = [
  ["DEPOSIT_PENDING", "签订合同"], ["DESIGN_PENDING", "设计下单"], ["DESIGN_ACCEPTED", "设计提交"],
  ["PRE_REVIEW", "前置审单"], ["TECHNICAL", "技术拆单"], ["TECH_REVIEW", "技术审单"],
  ["MATERIALS", "物料采购"], ["PRODUCTION", "四车间生产"], ["DELIVERY", "发货"],
  ["INSTALLATION", "安装"], ["ACCEPTANCE", "客户验收"], ["BUSINESS_COMPLETE", "履约完成"], ["AFTERSALES", "售后"],
] as const;

const displayStage = (stage: string) => stage === "INSTALLATION_APPLICATION" ? "DELIVERY" : stage;
const stageLabel = (stage: string) => STAGES.find(([candidate]) => candidate === displayStage(stage))?.[1];

const formatDay = (value?: string | null) => value
  ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value))
  : "—";

export function MobileReadonly({ employee, orders, api, filing, onRefresh, onLogout }: {
  employee: MobileEmployee;
  orders: MobileOrder[];
  api: ApiCall;
  filing: FilingConfig;
  onRefresh: () => Promise<void>;
  onLogout: (destination?: string) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<MobileOrder | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return orders;
    return orders.filter((order) => [order.salesNumber, order.productionNumber, order.trackingSerial, order.customerName, order.address]
      .some((value) => value?.toLowerCase().includes(query)));
  }, [orders, search]);

  const openOrder = async (id: string) => {
    setDetailLoading(true);
    try {
      const [order, events] = await Promise.all([
        api<MobileOrder>(`/api/v1/orders/${id}`),
        api<TimelineItem[]>(`/api/v1/orders/${id}/timeline`),
      ]);
      setSelected(order);
      setTimeline(events.slice(0, 8));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally { setDetailLoading(false); }
  };

  const refresh = async () => {
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  };

  if (employee.role !== "CHAIRMAN") return <main className="tai-mobile tai-mobile-centered">
    <Card>
      <Alert type="warning" showIcon title="此入口仅供董事长管理员只读查看" description="当前账号不能使用手机总览，请返回桌面管理端按原岗位权限操作。" />
      <Space direction="vertical" style={{ width: "100%", marginTop: 16 }}>
        <Button block onClick={() => onLogout("/")}>返回桌面登录</Button>
        <Button block type="text" icon={<RiLogoutBoxRLine size={17} />} onClick={() => onLogout()}>退出账号</Button>
      </Space>
    </Card>
  </main>;

  if (selected || detailLoading) {
    const currentIndex = selected ? Math.max(0, STAGES.findIndex(([stage]) => stage === (selected.afterSalesActive ? "AFTERSALES" : displayStage(selected.stage)))) : 0;
    return <main className="tai-mobile">
      <header className="tai-mobile-header">
        <Button type="text" aria-label="返回订单列表" icon={<RiArrowLeftLine size={20} />} onClick={() => { setSelected(null); setTimeline([]); }} />
        <div><strong>订单进度</strong><span>只读查看</span></div>
        <Button type="text" aria-label="刷新订单" loading={detailLoading} icon={<RiRefreshLine size={19} />} onClick={() => selected && openOrder(selected.id)} />
      </header>
      {detailLoading || !selected ? <div className="tai-mobile-body"><Card><Skeleton active /></Card></div> : <div className="tai-mobile-body">
        <Card className="tai-mobile-hero">
          <span className="tai-mobile-kicker">{selected.salesNumber ? "销售编号" : "跟单流水号"}</span>
          <Typography.Title level={3}>{selected.salesNumber ?? selected.trackingSerial}</Typography.Title>
          <p>{selected.customerName} · {selected.businessTypeLabel} · {selected.creationModeLabel ?? "常规销售订单"}</p>
          <Space><Tag color="cyan">{selected.stageLabel ?? stageLabel(selected.stage)}</Tag>{selected.afterSalesActive && <Tag color="purple">售后处理中 · {selected.afterSalesCount ?? 0}</Tag>}</Space>
        </Card>
        <Card title="生命周期进度" className="tai-mobile-card">
          <div className="tai-mobile-stages">{STAGES.map(([stage, rawLabel], index) => { const label = stage === "DEPOSIT_PENDING" && selected.creationMode === "INTERNAL_EXCEPTION" ? "商务确认" : rawLabel; return <div className={index < currentIndex ? "done" : index === currentIndex ? "current" : ""} key={stage}><i>{index < currentIndex ? "✓" : index + 1}</i><span>{label}</span></div>; })}</div>
        </Card>
        <Card title="当前控制面" className="tai-mobile-card">
          <dl className="tai-mobile-facts">
            <div><dt><RiUserFollowLine size={17} />当前负责人</dt><dd>{selected.currentOwnerLabel}</dd></div>
            <div><dt><RiTimeLine size={17} />下一动作</dt><dd className="accent">{selected.nextAction}</dd></div>
            <div><dt><RiTimeLine size={17} />当前截止</dt><dd>{formatDay(selected.currentTask?.dueAt ?? selected.internalDueAt)}</dd></div>
            <div><dt><RiAlarmWarningLine size={17} />风险</dt><dd className={selected.riskCount ? "danger" : ""}>{selected.riskCount ? `${selected.riskCount} 项待处理` : "无待处理风险"}</dd></div>
          </dl>
        </Card>
        <Card title="发货履约线" className="tai-mobile-card">
          <div className="tai-mobile-tracks">
            <section>
              <header><strong>定制产品区域发货批次</strong><Tag color={selected.fulfillmentTracks?.manufactured.shipped ? "success" : selected.fulfillmentTracks?.manufactured.allowed ? "cyan" : "default"}>{selected.fulfillmentTracks?.manufactured.shipped ? "各区域末批已登记" : selected.fulfillmentTracks?.manufactured.allowed ? "可登记批次" : "待解锁"}</Tag></header>
              <div className="tai-mobile-gates">
                <div className={selected.fulfillmentTracks?.manufactured.allProductionAreasComplete ? "ok" : "waiting"}><RiShieldCheckLine size={19} /><span>全部区域</span><strong>{selected.fulfillmentTracks?.manufactured.allProductionAreasComplete ? "已完工" : "生产中"}</strong></div>
                <div className={selected.shipmentGate?.tailPaymentConfirmed ? "ok" : "waiting"}><RiShieldCheckLine size={19} /><span>尾款确认</span><strong>{selected.shipmentGate?.tailPaymentConfirmed ? "已完成" : "待完成"}</strong></div>
                <div className="ok"><RiShieldCheckLine size={19} /><span>安装安排</span><strong>按自产发货车次记录</strong></div>
              </div>
            </section>
            <section>
              <header><strong>外购产品独立发货</strong><Tag color={selected.fulfillmentTracks?.outsourced.allShipped ? "success" : "blue"}>{selected.fulfillmentTracks?.outsourced.applicable ? `${selected.fulfillmentTracks.outsourced.shippedCount}/${selected.fulfillmentTracks.outsourced.lines.length} 已发` : selected.fulfillmentTracks?.outsourced.mode === "LEGACY_EXEMPT" ? "历史豁免" : "无外购"}</Tag></header>
              {selected.fulfillmentTracks?.outsourced.applicable ? <div className="tai-mobile-outsource-lines">{selected.fulfillmentTracks.outsourced.lines.map((line) => <div key={line.id}><span><strong>{line.name}</strong><small>{line.arrivedQty}/{line.plannedQty} {line.unit}</small></span><Tag color={line.status === "SHIPPED" ? "success" : line.status === "READY" ? "cyan" : line.status === "PARTIAL" ? "warning" : "default"}>{{ NOT_ARRIVED: "未到货", PARTIAL: "部分到货", READY: "已齐套", SHIPPED: "已发货" }[line.status] ?? line.status}</Tag></div>)}</div> : <p className="tai-mobile-track-note">{selected.fulfillmentTracks?.outsourced.mode === "LEGACY_EXEMPT" ? "历史订单不新增外购阻断。" : "技术已明确本订单无外购成品。"}</p>}
            </section>
          </div>
        </Card>
        {Boolean(selected.risks?.length) && <Card title="风险与处理方向" className="tai-mobile-card"><div className="tai-mobile-risks">{selected.risks!.map((risk) => <article key={risk.id}><strong>{risk.title}</strong><p>{risk.description}</p><small>影响：{risk.impact}</small><small>责任：{risk.responsible}</small><Tag>{risk.resolutionLabel}</Tag></article>)}</div></Card>}
        <Card title="订单摘要" className="tai-mobile-card">
          <dl className="tai-mobile-summary"><div><dt>客户交期</dt><dd>{formatDay(selected.promisedAt)}</dd></div><div><dt>销售 / 设计</dt><dd>{selected.sales?.name ?? "—"} / {selected.designer?.name ?? "待分配"}</dd></div><div><dt>项目地址</dt><dd>{selected.address}</dd></div></dl>
        </Card>
        <Card title="最近状态变化" className="tai-mobile-card">
          {timeline.length ? <div className="tai-mobile-timeline">{timeline.map((event) => <article key={event.id}><i /><div><strong>{event.title}</strong><p>{event.description}</p><small>{formatDay(event.createdAt)} · {event.actor?.name ?? "系统"}</small></div></article>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无状态变化记录" />}
        </Card>
      </div>}
    </main>;
  }

  const riskOrders = orders.filter((order) => order.riskCount > 0).length;
  const gateOrders = orders.filter((order) => ["INSTALLATION_APPLICATION", "DELIVERY"].includes(order.stage)).length;
  return <main className="tai-mobile">
    <header className="tai-mobile-home-header">
      <div className="tai-mobile-brand"><div>苔</div><span><strong>苔的跟单旅程</strong><small>董事长只读视图</small></span></div>
      <Button type="text" aria-label="退出登录" icon={<RiLogoutBoxRLine size={20} />} onClick={() => onLogout()} />
    </header>
    <div className="tai-mobile-body">
      <section className="tai-mobile-welcome"><span>{employee.department}</span><Typography.Title level={2}>{employee.name}，今天先看哪里？</Typography.Title><p>这里仅用于查看真实进度，所有业务办理仍在电脑端完成。</p></section>
      <section className="tai-mobile-metrics">
        <Card><RiFileCopy2Line size={19} /><span>全部订单</span><strong>{orders.length}</strong></Card>
        <Card><RiAlarmWarningLine size={19} /><span>风险订单</span><strong className="danger">{riskOrders}</strong></Card>
        <Card><RiShieldCheckLine size={19} /><span>待发货</span><strong>{gateOrders}</strong></Card>
      </section>
      <Input size="large" allowClear prefix={<RiSearchLine size={18} />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索编号、客户或地址" suffix={<Button type="text" aria-label="刷新" loading={refreshing} icon={<RiRefreshLine size={18} />} onClick={refresh} />} />
      <section className="tai-mobile-order-list">
        {filtered.length ? filtered.map((order) => <button type="button" key={order.id} onClick={() => openOrder(order.id)}>
          <header><div><strong>{order.salesNumber ?? order.trackingSerial}</strong><small>{order.customerName} · {order.businessTypeLabel}{order.creationMode === "INTERNAL_EXCEPTION" ? ` · ${order.chargeModeLabel ?? "非常规"}` : ""}</small></div><Space size={4}>{order.afterSalesActive && <Tag color="purple">售后处理中</Tag>}<Tag color={order.riskCount ? "error" : "cyan"}>{order.riskCount ? `${order.riskCount}项风险` : order.stageLabel ?? stageLabel(order.stage)}</Tag></Space></header>
          <dl><div><dt>当前负责</dt><dd>{order.currentOwnerLabel}</dd></div><div><dt>下一动作</dt><dd>{order.nextAction}</dd></div><div><dt>客户交期</dt><dd>{formatDay(order.promisedAt)}</dd></div></dl>
        </button>) : <Card><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合条件的订单" /></Card>}
      </section>
      <footer className="tai-mobile-footer"><span>苔的跟单旅程 · 只读入口 · 所有权限由服务端核验</span>{filing.icpFilingNumber && <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">{filing.icpFilingNumber}</a>}{filing.publicSecurityFilingNumber && <a href={filing.publicSecurityFilingUrl || "https://beian.mps.gov.cn/"} target="_blank" rel="noreferrer">{filing.publicSecurityFilingNumber}</a>}</footer>
    </div>
  </main>;
}

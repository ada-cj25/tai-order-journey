import { useEffect, useRef, useState } from "react";
import { RiChat3Line, RiBookOpenLine, RiPulseLine, RiBarChartBoxLine, RiCustomerService2Line } from "@remixicon/react";
import "./customer-demo.css";
import publicReviewKnowledge from "../customer-agent/knowledge/review/furniture-qa-2026-10-15.json";
import companyReviewKnowledge from "../customer-agent/knowledge/review/company-change-policy-2026-10-16.json";
import demoKnowledge from "../customer-agent/knowledge/demo.json";
import benchmark from "../customer-agent/benchmark-result.json";

const reviewKnowledge = {
  schema_version: "1.0",
  title: "本地客服知识待审核草稿（公开资料与用户提供规则）",
  status: "pending_company_review",
  active_for_answers: false,
  chunks: [...publicReviewKnowledge.chunks, ...companyReviewKnowledge.chunks],
  sources: [...publicReviewKnowledge.sources, ...companyReviewKnowledge.sources],
};

type TraceEvent = { step: string; status: string; at?: number; name?: string; durationMs?: number; engine?: string; summary?: string; tools?: string[]; args?: unknown; result?: unknown; resultCount?: number; requestId?: string; errorType?: string; queryRewritten?: boolean };
type Runtime = { llmConfigured: boolean; model: string; llm: { lastSuccessAt: number | null; lastErrorType: string | null }; denseEnabled: boolean; denseLoaded: boolean; rerankEnabled: boolean; rerankLoaded: boolean; activeChunks: number; previewChunks: number; mixedSearchChunks: number; reviewChunks: number; vectorizedChunks: number; memory: string };
type View = "chat" | "knowledge" | "monitor" | "evaluation" | "support";
const navigation = [
  { id: "chat" as View, icon: RiChat3Line, title: "对话工作台", subtitle: "会话、订单与执行诊断" },
  { id: "knowledge" as View, icon: RiBookOpenLine, title: "知识库", subtitle: "演示语料与待审核资料" },
  { id: "monitor" as View, icon: RiPulseLine, title: "运行状态", subtitle: "模型、检索与执行约束" },
  { id: "evaluation" as View, icon: RiBarChartBoxLine, title: "评测实验室", subtitle: "检索与 Agent 样本结果" },
  { id: "support" as View, icon: RiCustomerService2Line, title: "人工请求", subtitle: "处理状态与员工回复" },
];
const stepNames: Record<string, string> = { prepare: "加载会话", decide: "Agent 决策", tool: "工具调用", answer: "组织回答", validate: "证据校验", handoff: "转人工", finish: "保存状态" };
const statusNames: Record<string, string> = { ok: "成功", tool_request: "选择工具", answer: "进入回答", factual: "证据摘录", model_draft: "模型草稿", passed: "通过", fallback: "已降级", failed: "失败", complete: "完成", created: "已创建", rejected: "已拦截", budget_exhausted: "执行预算用尽" };
function TraceList({ events }: { events: TraceEvent[] }) {
  return <ol className="customer-trace">{events.map((event, i) => <li key={i}>
    <div className="customer-trace-heading"><span className={"customer-step step-" + event.step}>{stepNames[event.step] ?? event.step}</span><small>{event.durationMs !== undefined ? event.durationMs + " ms" : ""}</small></div>
    <strong>{event.name ?? (event.tools?.length ? event.tools.join(" + ") : statusNames[event.status] ?? event.status)}</strong>
    {event.name && <small>{statusNames[event.status] ?? event.status}{event.resultCount !== undefined ? ` · ${event.resultCount} 项结果` : ""}</small>}
    {event.summary && <p>{event.summary}</p>}
    {event.engine && <small>{event.engine === "deepseek" ? "DeepSeek 实际调用" : event.engine === "fallback" ? "LLM 异常 · 规则兜底" : "本地规则 · 未调用 LLM"}</small>}
    {event.queryRewritten && <small>已补全当前指代订单</small>}
    {event.errorType && <small className="customer-warning">{event.errorType}</small>}
    {event.args !== undefined && <details><summary>调用参数</summary><pre>{JSON.stringify(event.args, null, 2)}</pre></details>}
    {event.result !== undefined && <details><summary>结果与证据</summary><pre>{JSON.stringify(event.result, null, 2)}</pre></details>}
    {event.requestId && <small>工单 {event.requestId}</small>}
  </li>)}</ol>;
}
function downloadReview() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(reviewKnowledge, null, 2)], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = "customer-knowledge-review-2026-10-16.json"; link.click(); URL.revokeObjectURL(url);
}

type CustomerOrder = { orderId: string; identifier: string; trackingSerial: string | null; stage: string; updatedAt: string };
type Progress = {
  identifier: string; trackingSerial: string | null; stage: string; customerDueDate: string;
  finalAcceptedDate: string | null; queriedAt: string;
  areas: Array<{ name: string; productionCompleted: boolean; shipped: boolean; routes: Array<{ kind: string; released: boolean; completed: boolean; shipped: boolean }> }>;
  shipments: Array<{ kind: string; deliveredDate: string; plannedInstallationDate: string | null; installedDate: string | null }>;
  aftersales: Array<{ status: string; openedDate: string; resolvedDate: string | null }>;
};
type Message = { role: "user" | "assistant"; content: string; sources?: string[]; trace?: TraceEvent[] };
type Support = { id: string; question: string; status: string; replies: Array<{ id: string; body: string; createdAt: string }> };

export default function CustomerDemo() {
  const [enabled, setEnabled] = useState(false);
  const [checking, setChecking] = useState(true);
  const [customer, setCustomer] = useState<{ id: string; phone: string } | null>(null);
  const [csrf, setCsrf] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [demoCode, setDemoCode] = useState("");
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [selected, setSelected] = useState<CustomerOrder | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [support, setSupport] = useState<Support[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("chat");
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [runtimeError, setRuntimeError] = useState("");
  const [knowledgeTab, setKnowledgeTab] = useState<"review" | "active">("review");
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const messagesEnd = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const latest = [...messages].reverse().find((item) => item.role === "assistant");
  const trace = latest?.trace ?? [];
  const retrievedKnowledgeIds = new Set(trace.filter((event) => event.name === "search_knowledge" && event.status === "ok")
    .flatMap((event) => Array.isArray(event.result) ? (event.result as Array<{ id?: string }>).map((item) => item?.id).filter((id): id is string => typeof id === "string") : []));
  const knowledgeHit = retrievedKnowledgeIds.size;
  const knowledgeCited = latest?.sources?.filter((id) => retrievedKnowledgeIds.has(id)).length ?? 0;
  const lastDecision = [...trace].reverse().find((event) => event.step === "decide" && event.engine);
  const elapsed = trace.length > 1 && trace[0].at && trace.at(-1)?.at ? Math.round((trace.at(-1)!.at! - trace[0].at) * 1000) : null;
  const hasFallback = trace.some((event) => event.status === "fallback" || event.engine === "fallback");
  const hasHandoff = trace.some((event) => event.step === "handoff" && event.status === "created");
  const llmLabel = !runtime ? "状态待检查" : !runtime.llmConfigured ? "LLM 未配置" : runtime.llm.lastErrorType ? "LLM 最近调用异常" : runtime.llm.lastSuccessAt ? "LLM 已调用成功" : "LLM 已配置 · 待验证";

  async function loadRuntime() {
    try { setRuntime(await api<Runtime>("runtime")); setRuntimeError(""); }
    catch { setRuntime(null); setRuntimeError("Agent 状态暂不可用，请确认本地服务已启动。"); }
  }
  useEffect(() => { if (customer) { void loadRuntime(); void refresh().catch(() => setError("订单或人工请求暂未加载成功")); } }, [customer?.id]);
  useEffect(() => {
    const container = messagesEnd.current?.parentElement;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, view]);

  async function api<T>(path: string, method = "GET", body?: object): Promise<T> {
    const response = await fetch("/api/v1/customer/" + path, {
      method, credentials: "include",
      headers: { "Content-Type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "请求失败");
    return data as T;
  }

  async function refresh() {
    const [found, requests] = await Promise.all([api<CustomerOrder[]>("orders"), api<Support[]>("support")]);
    setOrders(found);
    setSupport(requests);
    if (selected) {
      const stillAllowed = found.find((item) => item.orderId === selected.orderId);
      setSelected(stillAllowed ?? null);
      setProgress(stillAllowed ? await api<Progress>("orders/" + stillAllowed.orderId) : null);
    }
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/v1/public/config").then((response) => response.json()),
      fetch("/api/v1/customer/me", { credentials: "include" }).then(async (response) => response.ok ? response.json() : null),
    ]).then(async ([config, session]) => {
      setEnabled(config.customerDemoEnabled === true);
      if (session?.customer) {
        setCustomer(session.customer);
        setCsrf(session.csrfToken);
        const found = await fetch("/api/v1/customer/orders", { credentials: "include" }).then((response) => response.json());
        setOrders(found);
      }
    }).catch(() => setError("本地客服服务尚未启动")).finally(() => setChecking(false));
  }, []);

  async function action(fn: () => Promise<void>) {
    setBusy(true); setError("");
    try { await fn(); } catch (cause) {
      const message = cause instanceof Error ? cause.message : "请求失败";
      setError(message);
      setMessages((current) => current.map((item, index) => index === current.length - 1 && item.role === "assistant" && item.content === "正在核对资料…" ? { ...item, content: message } : item));
    }
    finally { setBusy(false); }
  }

  async function choose(order: CustomerOrder) {
    await action(async () => {
      const detail = await api<Progress>("orders/" + order.orderId);
      setSelected(order); setProgress(detail);
    });
  }

  async function send() {
    const text = question.trim();
    if (!text || inFlight.current) return;
    inFlight.current = true;
    setQuestion("");
    setMessages((current) => [...current, { role: "user", content: text }, { role: "assistant", content: "正在核对资料…", trace: [] }]);
    await action(async () => {
      const response = await fetch("/api/v1/customer/chat/stream", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ question: text, ...(threadId ? { threadId } : {}) }),
      });
      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.message || "客服暂时无法回答，可转人工处理");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((part) => part.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === "trace") {
            setMessages((current) => current.map((item, index) => index === current.length - 1 ? { ...item, trace: [...(item.trace ?? []), event.event] } : item));
          } else if (event.type === "result") {
            completed = true;
            setThreadId(event.threadId);
            setMessages((current) => current.map((item, index) => index === current.length - 1 ? { ...item, content: event.answer, sources: event.sources } : item));
          } else if (event.type === "error") throw new Error(event.message);
        }
      }
      if (!completed) throw new Error("客服回答未完成，可转人工处理");
      await refresh();
      await loadRuntime();
    });
    inFlight.current = false;
  }

  async function handoff() {
    const lastQuestion = [...messages].reverse().find((item) => item.role === "user")?.content ?? question.trim();
    if (!lastQuestion) return;
    await action(async () => {
      await api("support", "POST", {
        orderId: selected?.orderId, question: lastQuestion, reason: "客户请求人工处理",
        idempotencyKey: threadId ? threadId + ":" + messages.length : crypto.randomUUID(),
      });
      await refresh();
      setView("support");
    });
  }

  if (checking) return <main className="customer-page"><p>正在检查本地客服环境…</p></main>;
  if (!enabled) return <main className="customer-page"><h1>苔的跟单旅程</h1><p>客户客服 Demo 仅在独立的本地测试环境开放。</p></main>;

  return <main className="customer-page">
    <aside className="customer-sidebar">
      <a className="customer-brand" href="/customer"><span className="customer-logo">苔</span><span>苔的跟单旅程<small>CUSTOMER SERVICE LAB</small></span></a>
      <div className="customer-sidebar-caption">智能客服 · 本地演示</div>
      <nav aria-label="客服工作台导航">{navigation.map((item) => <button key={item.id} disabled={!customer || busy} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><item.icon className="customer-nav-icon" size={21} aria-hidden="true" /><span>{item.title}<small>{item.subtitle}</small></span></button>)}</nav>
      <div className="customer-sidebar-bottom"><span className="customer-local-dot" />本地隔离环境<p>受控单 Agent<br />仅使用虚构订单进行演示</p>{customer && <><small>当前账号 {customer.phone.slice(0, 3)}****{customer.phone.slice(-4)}</small><button disabled={busy} onClick={() => action(async () => { await api("logout", "POST"); setCustomer(null); setOrders([]); setSelected(null); setProgress(null); setMessages([]); setThreadId(null); setSupport([]); setRuntime(null); setPhone(""); setCode(""); setDemoCode(""); setView("chat"); })}>退出 / 切换账号</button></>}</div>
    </aside>
    <div className="customer-main">
      <header className="customer-header"><div><div className="customer-eyebrow">苔 · CUSTOMER EXPERIENCE</div><h1>{customer ? navigation.find((item) => item.id === view)?.title : "欢迎来到智能客服工作台"}</h1><p>查询订单、核对知识，让每一次回答都有迹可循。</p></div><div className="customer-header-status"><span className="customer-badge">单 Agent · LangGraph</span><span className={"customer-badge " + (runtime?.llm.lastSuccessAt && !runtime?.llm.lastErrorType ? "good" : "muted")}>{llmLabel}</span></div></header>
      {!customer ? <section className="customer-card customer-login">
        <span className="customer-eyebrow">LOCAL DEMO ACCESS</span><h2>登录查询订单</h2><p>验证手机号后，查看员工已确认绑定的订单。</p>
        <label>手机号<input value={phone} inputMode="tel" maxLength={11} onChange={(event) => setPhone(event.target.value)} placeholder="请输入测试手机号" /></label>
        <div className="customer-account-picks">{["13800000001", "13800000002"].map((value, i) => <button key={value} disabled={busy} onClick={() => { setPhone(value); setCode(""); setDemoCode(""); }}>测试客户 {i + 1}</button>)}</div>
        <button disabled={busy} onClick={() => action(async () => { const result = await api<{ demoCode: string }>("otp/request", "POST", { phone }); setDemoCode(result.demoCode); })}>获取模拟验证码</button>
        {demoCode && <p className="customer-demo-code">本地模拟验证码：<strong>{demoCode}</strong></p>}
        <label>验证码<input value={code} inputMode="numeric" maxLength={6} onChange={(event) => setCode(event.target.value)} placeholder="6 位验证码" /></label>
        <button className="customer-primary" disabled={busy} onClick={() => action(async () => {
          const result = await api<{ customer: { id: string; phone: string }; csrfToken: string }>("otp/verify", "POST", { phone, code });
          setCustomer(result.customer); setCsrf(result.csrfToken);
        })}>验证并进入工作台 →</button>
        <small>当前为模拟短信；尚未接入真实短信服务。</small>
      </section> : <>
      {view === "chat" && <div className="customer-workbench">
        <aside className="customer-quick-column">
          <section className="customer-card"><h2>快速开始</h2><p className="customer-note">选一个问题，观察执行过程。</p><div className="customer-prompts">{["我的订单目前做到哪一步了？", "我的订单明天一定能发货吗？", "柜门可以用酒精清洁吗？", "售后出现问题怎么处理？"].map((text, i) => <button key={text} disabled={busy} onClick={() => setQuestion(text)}><small>0{i + 1}</small>{text}<span>↗</span></button>)}</div></section>
          <section className="customer-card"><div className="customer-section-heading"><h2>授权订单</h2><button className="customer-text-button" disabled={busy} onClick={() => action(refresh)}>刷新</button></div><small className="customer-note">仅展示当前手机号获授权的订单</small>
          {orders.length ? orders.map((order) => <button disabled={busy} key={order.orderId} className={"customer-order " + (selected?.orderId === order.orderId ? "selected" : "")} onClick={() => choose(order)}><strong>{order.identifier}</strong><span><i className="customer-local-dot" />{order.stage}</span></button>) : <p>暂无已授权订单，请联系员工确认绑定。</p>}
          {progress && <div className="customer-progress"><small>客户约定交期</small><strong>{progress.customerDueDate}</strong>{progress.areas.map((area) => <p key={area.name}>{area.name} · {area.routes.length ? area.routes.map((route) => route.kind + "：" + (route.shipped ? "已发货" : route.completed ? "已完成" : route.released ? "进行中" : "待开放")).join(" / ") : "暂无路线记录"}</p>)}<button disabled={busy} onClick={() => setQuestion(`查询订单 ${progress.identifier} 的进度`)}>向客服询问这笔订单</button></div>}
          </section>
          <p className="customer-footnote">订单事实来自本地 PostgreSQL；公司规则须有已审核知识支持。</p>
        </aside>
        <section className="customer-card customer-chat"><div className="customer-section-heading"><div><h2>会话窗口</h2><p className="customer-note">订单进度 · 材料知识 · 售后咨询</p></div><span className={"customer-badge " + (busy ? "working" : "good")}>{busy ? "执行中" : "Ready"}</span></div>
          <div className="customer-messages" aria-live="polite">{messages.length ? messages.map((item, i) => <article key={i} className={"customer-message " + item.role}><div className="customer-message-label">{item.role === "user" ? "您" : "苔 · 智能客服"}</div><p>{item.content}</p>{item.sources?.length ? <div className="customer-sources">{item.sources.map((source) => <span key={source}>↗ {source}</span>)}</div> : null}{item.trace?.length ? <details className="customer-inline-trace"><summary>执行轨迹 · {item.trace.length} 步</summary><TraceList events={item.trace} /></details> : null}</article>) : <div className="customer-chat-empty"><span className="customer-empty-mark">苔</span><h3>从一个问题开始</h3><p>我可以帮你查询订单进度，<br />或根据已核实资料回答材料与售后问题。</p><span>每次查询都重新校验订单权限</span></div>}<div ref={messagesEnd} /></div>
          <div className="customer-compose"><textarea value={question} disabled={busy} maxLength={2000} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder="输入客服问题，例如：我的订单做到哪一步了？" aria-label="输入问题" /><div className="customer-compose-actions"><small>Enter 发送 · Shift + Enter 换行</small><button className="customer-primary" disabled={busy || !question.trim()} onClick={send}>发送消息 ↑</button></div></div>
          <div className="customer-chat-footer"><button disabled={busy} onClick={() => { setMessages([]); setThreadId(null); setQuestion(""); setError(""); }}>＋ 新建会话</button><button disabled={busy || (!messages.some((item) => item.role === "user") && !question.trim())} onClick={handoff}>转人工处理 ↗</button></div>
        </section>
        <aside className="customer-card customer-diagnostics"><div className="customer-section-heading"><h2>诊断侧栏</h2><span className="customer-live-label">● LIVE</span></div><p className="customer-note">展示结构化执行事件与工具证据。</p><div className="customer-diagnostic-stats"><div><small>执行方式</small><strong>{lastDecision?.engine === "deepseek" ? "DeepSeek 决策" : lastDecision?.engine === "fallback" ? "规则兜底" : lastDecision ? "本地规则" : "等待提问"}</strong></div><div><small>检索候选</small><strong>{knowledgeHit} 条</strong><small>回答引用 {knowledgeCited} 条</small></div><div><small>本轮耗时</small><strong>{elapsed !== null ? elapsed + " ms" : "—"}</strong></div><div><small>证据校验</small><strong>{hasFallback ? "已降级" : trace.some((e) => e.step === "validate") ? "已通过" : "待执行"}</strong></div></div>
          <h3>最新执行轨迹 <span>{trace.length ? `${trace.length} 步` : ""}</span></h3><div className="customer-diagnostic-trace">{trace.length ? <TraceList events={trace} /> : <div className="customer-trace-empty">发送消息后，实时查看<br />决策 → 工具 → 校验 → 完成</div>}</div><div className="customer-diagnostic-footer"><small>人工转接</small><strong>{hasHandoff ? "已创建人工请求" : "本轮尚未自动转接"}</strong><small>{runtime?.llmConfigured ? "已配置模型，调用结果以实际轨迹为准" : "未配置模型密钥，当前使用规则演示"}</small></div>
        </aside>
      </div>}
      {view === "knowledge" && <section className="customer-card customer-content-page"><div className="customer-section-heading"><div><h2>知识资料</h2><p className="customer-note">改色问题在本地从完整知识库检索，草稿引用仍标明待审核。</p></div><button className="customer-primary" onClick={downloadReview}>下载调研 JSON ↓</button></div><div className="customer-tabs"><button className={knowledgeTab === "review" ? "active" : ""} onClick={() => setKnowledgeTab("review")}>待审核草稿 · {reviewKnowledge.chunks.length}</button><button className={knowledgeTab === "active" ? "active" : ""} onClick={() => setKnowledgeTab("active")}>演示语料 · {demoKnowledge.length}</button></div><input className="customer-search" placeholder="搜索问题、正文或分类" aria-label="搜索知识资料" value={knowledgeQuery} onChange={(event) => setKnowledgeQuery(event.target.value)} /><p className="customer-notice">{knowledgeTab === "review" ? "改色问题从全部 32 条切片召回、融合并重排；公开资料与拟议流程只参与检索，不作为公司政策回答。用户提供的规则草稿用于本地预览时须注明待审核。" : "一般问答仅检索这 4 条已批准的虚构演示语料；改色问题在本地从全部 32 条切片检索，不代表正式公司政策。"}</p><div className="customer-knowledge-grid">{knowledgeTab === "review" ? reviewKnowledge.chunks.filter((item) => (item.title + item.content + item.category).includes(knowledgeQuery)).map((item) => <article className="customer-knowledge-item" key={item.id}><span className="customer-badge muted">{item.category} · 待审核</span><h3>{item.title}</h3><p>{item.content}</p><small>{item.evidence_type === "proposed_workflow" ? "拟议流程 · 待业务确认" : item.evidence_type === "user_provided_company_rule" ? "用户提供的公司规则 · 待公司确认" : "基于公开资料整理 · 待公司确认"}</small><div className="customer-research-question"><strong>调研：{item.owner_department}</strong><p>{item.company_questions.join("；")}</p></div>{item.source_ids.map((id) => { const source = reviewKnowledge.sources.find((source) => source.id === id); return source ? <a key={id} href={source.url} target="_blank" rel="noreferrer" title={source.scope}>来源：{source.title} ↗</a> : null; })}</article>) : demoKnowledge.filter((item) => (item.title + item.content + item.category).includes(knowledgeQuery)).map((item) => <article className="customer-knowledge-item" key={item.id}><span className="customer-badge good">演示专用 · {item.category}</span><h3>{item.title}</h3><p>{item.content}</p><small>{item.id} · {item.version}</small></article>)}</div></section>}
      {view === "monitor" && <section className="customer-card customer-content-page"><div className="customer-section-heading"><div><h2>运行状态与执行约束</h2><p className="customer-note">状态来自本地 Agent 服务，配置完成不等于真实调用成功。</p></div><button onClick={loadRuntime}>刷新状态</button></div>{runtimeError && <p className="customer-notice">{runtimeError}</p>}<div className="customer-monitor-grid"><article><h3>LLM</h3><strong>{llmLabel}</strong><p>模型：{runtime?.model ?? "未知"}</p><p>最近成功：{runtime?.llm.lastSuccessAt ? new Date(runtime.llm.lastSuccessAt * 1000).toLocaleString("zh-CN") : "本进程尚无成功记录"}</p><p>最近错误：{runtime?.llm.lastErrorType ?? "无记录"}</p><small>密钥保存在后端本地配置，不经过浏览器。</small></article><article><h3>知识检索</h3><strong>{runtime ? `${runtime.mixedSearchChunks} 条本地检索候选` : "待检查"}</strong><p>BM25 Top20 + Dense Top20 → RRF → Cross-Encoder Top20 → 取证 Top8</p><p>一般问答已批准演示：{runtime?.activeChunks ?? "—"} 条 · 待审核：{runtime?.reviewChunks ?? "—"} 条 · 已向量化：{runtime?.vectorizedChunks ?? "—"} 条</p><p>Dense：{runtime?.denseEnabled ? runtime.denseLoaded ? "已加载 BGE-M3" : "已启用，待加载" : "未启用"}</p><p>Cross-Encoder：{runtime?.rerankEnabled ? runtime.rerankLoaded ? "已加载" : "已启用，待加载" : "未启用"}</p></article><article><h3>会话与数据</h3><strong>独立本地 PostgreSQL</strong><p>{runtime?.memory ?? "等待运行状态"}</p><p>最近 8 轮、主题摘要与结构化上下文</p><small>知识缓存目前在进程内；尚未接入 Redis。</small></article><article><h3>Harness 约束</h3><strong>权限与证据优先</strong><p>工具白名单 / 参数校验 / 超时 / 熔断 / 循环预算</p><p>每轮重新检查订单授权，无依据不作业务承诺。</p><small>这些约束降低幻觉风险，不能保证完全消除幻觉。</small></article></div><div className="customer-notice">本地接入命令：<code>python3 scripts/configure-customer-llm.py</code>。保存 key 后重启 Agent，再发送问题验证实际调用。</div></section>}
      {view === "evaluation" && <section className="customer-card customer-content-page"><h2>演示基线报告</h2><p className="customer-note">来自已保存的 benchmark-result.json，并非当前会话的实时评测。</p><p className="customer-notice">仅 4 条虚构知识、4 道检索题，不能代表真实业务效果。每题只标注 1 条相关文档，Precision@5 分母固定为 5。</p><div className="customer-metric-grid">{Object.entries(benchmark.retrieval.mean).map(([name, value]) => <article key={name}><small>{name}</small><strong>{value.toFixed(2)}</strong></article>)}</div><h3>Agent 规则检查 · {benchmark.agent.filter((item) => item.rule_pass).length} / {benchmark.agent.length}</h3>{benchmark.agent.map((item) => <div key={item.question} className="customer-eval-row"><span>{item.question}</span><span className="customer-badge good">{item.rule_pass ? "通过" : "未通过"}</span></div>)}<p>LLM-as-judge：{benchmark.llm_as_judge.status === "skipped_no_api_key" ? "本份报告未执行（生成时没有 API key）" : benchmark.llm_as_judge.status}</p><p className="customer-note">下一阶段使用公司审核资料与独立标注集，补充多轮澄清、无答案、权限越界及工具失败案例。</p></section>}
      {view === "support" && <section className="customer-card customer-content-page"><div className="customer-section-heading"><div><h2>我的人工请求</h2><p className="customer-note">仅展示当前客户仍有权限查看的请求。</p></div><button disabled={busy} onClick={() => action(refresh)}>刷新</button></div>{support.length ? support.map((item) => <article key={item.id} className="customer-support"><span className="customer-badge">{item.status === "CLOSED" ? "已关闭" : "待处理"}</span><h3>{item.question}</h3><small>编号 {item.id}</small>{item.replies.length ? item.replies.map((reply) => <p key={reply.id}>员工回复：{reply.body}</p>) : <p className="customer-note">等待员工处理，尚无回复。</p>}</article>) : <div className="customer-trace-empty">暂无人工请求。你可以在对话中申请转人工。</div>}</section>}
      </>}
      <footer className="customer-page-footer">苔的跟单旅程 · 客服功能验证环境<span>本地运行 / 虚构数据</span></footer>
    </div>
    {error && <div role="alert" className="customer-error">{error}<button onClick={() => setError("")}>关闭</button></div>}
  </main>;
}

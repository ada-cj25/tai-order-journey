"""Local-only customer agent. The ERP API remains authoritative for order access."""
import json
import os
import re
import time
import asyncio
import hashlib
import logging
from contextlib import asynccontextmanager
from typing import TypedDict
from uuid import UUID, uuid4

import httpx
from mcp import Client
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from knowledge import KnowledgeIndex, is_material_change_query, knowledge_query
from mcp_tools import mcp, configure

# Some MCP SDK logging configurations enable DEBUG globally. Never log LLM
# request headers or request/response bodies containing customer context.
for logger_name in ("openai", "httpx", "httpcore"):
    logging.getLogger(logger_name).setLevel(logging.WARNING)

DATABASE_URL = os.environ.get("CUSTOMER_AGENT_DATABASE_URL", "")
ERP_URL = os.environ.get("CUSTOMER_ERP_URL", "http://127.0.0.1:3100")
if not DATABASE_URL.endswith("/whole_house_erp_customer_agent_demo"):
    raise RuntimeError("Agent 只能连接独立的本地客服测试库")
if ERP_URL not in ("http://127.0.0.1:3100", "http://localhost:3100"):
    raise RuntimeError("Agent 只能查询本地 ERP API")

index = KnowledgeIndex(DATABASE_URL)
configure(index)
saver_context = None
graph = None
tool_failures: dict[str, int] = {}
tool_open_until: dict[str, float] = {}
knowledge_cache: dict[str, tuple[float, list[dict]]] = {}
llm_runtime = {"lastSuccessAt": None, "lastErrorType": None}

TOOLS = [
    {"type": "function", "function": {"name": "list_my_orders", "description": "List only the current customer's authorized orders; call before ambiguous order questions.", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_order_progress", "description": "Get current progress for an authorized order ID returned by list_my_orders.", "parameters": {"type": "object", "properties": {"order_id": {"type": "string"}}, "required": ["order_id"]}}},
    {"type": "function", "function": {"name": "search_knowledge", "description": "Search isolated local knowledge. Material-change queries rank the full demo corpus; pending drafts are not approved policy.", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
]
ALLOWED = {item["function"]["name"] for item in TOOLS}


class RunInput(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    serviceToken: str
    threadId: str | None = None


class State(TypedDict, total=False):
    question: str
    rewritten_question: str
    token: str
    customer_id: str
    thread_id: str
    history: list[dict]
    summary: str
    profile: dict
    evidence: list[dict]
    trace: list[dict]
    proposed_tools: list[dict]
    steps: int
    deadline: float
    status: str
    answer: str
    sources: list[str]


def trace(state: State, name: str, status: str, **details) -> list[dict]:
    return [*state.get("trace", []), {"step": name, "status": status, "at": time.time(), **details}]


def erp_get(path: str, token: str):
    with httpx.Client(timeout=3) as client:
        response = client.get(ERP_URL + path, headers={"x-customer-service-token": token})
        response.raise_for_status()
        return response.json()


async def _mcp_call_async(name: str, args: dict):
    async with Client(mcp) as client:
        result = await client.call_tool(name, args)
        if result.is_error or not result.content:
            raise RuntimeError("MCP tool failed")
        return json.loads(result.content[0].text)


def mcp_call(name: str, args: dict):
    now = time.monotonic()
    if now < tool_open_until.get(name, 0):
        raise RuntimeError("MCP tool circuit open")
    query = args.get("query") if name == "search_knowledge" else None
    if isinstance(query, str):
        cached = knowledge_cache.get(query)
        if cached and cached[0] > now:
            return cached[1]
    try:
        result = asyncio.run(asyncio.wait_for(_mcp_call_async(name, args), timeout=12 if query else 5))
        tool_failures[name] = 0
        if isinstance(query, str):
            knowledge_cache[query] = (now + 300, result)
        return result
    except Exception:
        tool_failures[name] = tool_failures.get(name, 0) + 1
        if tool_failures[name] >= 3:
            tool_open_until[name] = now + 30
            tool_failures[name] = 0
        raise


def model():
    key = os.environ.get("DEEPSEEK_API_KEY")
    if not key:
        return None
    return ChatOpenAI(
        model=os.environ.get("DEEPSEEK_MODEL", "deepseek-flash"),
        api_key=key,
        base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        temperature=0,
        timeout=20,
        max_retries=0,
        max_tokens=1000,
        extra_body={"thinking": {"type": "disabled"}},
    )


def prepare(state: State) -> State:
    # A fresh token is supplied by NestJS on every turn. Old order history is
    # filtered against today's grants before it reaches the model.
    authorized = erp_get("/api/v1/customer-internal/orders", state["token"])
    allowed = {item["orderId"] for item in authorized}
    history = [item for item in state.get("history", []) if not item.get("orderId") or item["orderId"] in allowed][-8:]
    question = state["question"]
    last_order = next((item.get("orderId") for item in reversed(history) if item.get("orderId") in allowed), None)
    named = next((item["identifier"] for item in authorized if item["orderId"] == last_order), None)
    rewritten = question + ("（当前指代订单：" + named + "）" if named and re.search(r"那(一)?(单|笔)|这(一)?(单|笔)|它|之前那单", question) else "")
    return {
        "history": history, "rewritten_question": rewritten,
        "profile": {"language": "zh-CN", "authorizedOrderCount": len(allowed)},
        "evidence": [], "trace": trace({}, "prepare", "ok", authorizedOrderCount=len(allowed), queryRewritten=rewritten != question, summary="重新校验订单权限并加载会话记忆"),
        "proposed_tools": [], "steps": 0, "deadline": time.time() + 60, "status": "running", "answer": "", "sources": [],
    }


def _local_decision(state: State) -> list[dict]:
    question = state.get("rewritten_question", state["question"])
    evidence = state.get("evidence", [])
    has_orders = any(item["kind"] == "order-list" for item in evidence)
    has_progress = any(item["kind"] == "order" for item in evidence)
    has_knowledge = any(item["kind"] == "knowledge" for item in evidence)
    order_words = bool(re.search(r"订单|我.*(柜|进度|发货|安装)|哪一步|什么时候.*(发|装)|那一单", question))
    knowledge_words = is_material_change_query(question) or bool(re.search(r"材料|保养|清洁|售后|保修|规则|怎么擦|酒精", question))
    if order_words and not has_orders and not has_progress:
        return [{"name": "list_my_orders", "args": {}}]
    if order_words and has_orders and not has_progress:
        candidates = next(item["data"] for item in evidence if item["kind"] == "order-list")
        named = [item for item in candidates if item["identifier"] in question or (item.get("trackingSerial") and item["trackingSerial"] in question)]
        last_order = next((item.get("orderId") for item in reversed(state.get("history", [])) if item.get("orderId")), None)
        referential = bool(re.search(r"那(一)?(单|笔)|这(一)?(单|笔)|它|之前那单", question))
        chosen = named[0] if len(named) == 1 else next((item for item in candidates if referential and item["orderId"] == last_order), None)
        if not chosen and len(candidates) == 1:
            chosen = candidates[0]
        if chosen:
            return [{"name": "get_order_progress", "args": {"order_id": chosen["orderId"]}}]
        return []
    if knowledge_words and not has_knowledge:
        return [{"name": "search_knowledge", "args": {"query": question}}]
    return []


def decide(state: State) -> State:
    if time.time() > state["deadline"] or state.get("steps", 0) >= 4:
        return {"proposed_tools": [], "trace": trace(state, "decide", "budget_exhausted")}
    started = time.monotonic()
    llm = model()
    engine = "deepseek" if llm else "local_rules"
    error_type = None
    if llm:
        try:
            context = json.dumps({
                "question": state.get("rewritten_question", state["question"]), "history": state.get("history", []),
                "summary": state.get("summary", ""), "profile": state.get("profile", {}),
                "evidence": [{"kind": item["kind"], "id": item["id"], "data": item["data"]} for item in state.get("evidence", [])],
            }, ensure_ascii=False)[:12000]
            response = llm.bind_tools(TOOLS).invoke([
                SystemMessage(content="你是客户客服的受控单Agent。订单事实必须使用订单工具，公司政策必须检索知识。订单不唯一时先停止并澄清。只调用提供的只读工具；不要猜测订单ID或发货日期。改色规则可能是待审核草稿，不能当作正式政策。已有足够证据时直接结束工具调用。"),
                HumanMessage(content=context),
            ])
            calls = [{"name": item["name"], "args": item.get("args") or {}} for item in response.tool_calls[:2]]
            llm_runtime.update(lastSuccessAt=time.time(), lastErrorType=None)
        except Exception as exc:
            calls = _local_decision(state)
            engine = "fallback"
            error_type = type(exc).__name__
            llm_runtime["lastErrorType"] = error_type
    else:
        calls = _local_decision(state)
    if (is_material_change_query(state.get("rewritten_question", state["question"]))
            and not any(item["kind"] == "knowledge" for item in state.get("evidence", []))
            and not any(call["name"] == "search_knowledge" for call in calls)):
        calls = [*calls[:1], {"name": "search_knowledge", "args": {"query": state.get("rewritten_question", state["question"])}}]
    if (is_material_change_query(state.get("rewritten_question", state["question"]))
            and any(item["kind"] == "knowledge" for item in state.get("evidence", []))):
        calls = [call for call in calls if call["name"] != "search_knowledge"]
        if not calls:
            # A repeated search must not consume the remaining tool budget or
            # prevent the order-progress lookup requested in the same turn.
            calls = _local_decision(state)
    completed_order_ids = {item["id"].removeprefix("order:") for item in state.get("evidence", []) if item["kind"] == "order"}
    has_authorized_list = any(item["kind"] == "order-list" for item in state.get("evidence", []))
    calls = [call for call in calls if not (
        (call["name"] == "get_order_progress" and call["args"].get("order_id") in completed_order_ids)
        or (call["name"] == "list_my_orders" and has_authorized_list)
    )]
    return {"proposed_tools": calls, "trace": trace(state, "decide", "tool_request" if calls else "answer", tools=[item["name"] for item in calls], engine=engine, errorType=error_type, durationMs=round((time.monotonic()-started)*1000), summary="请求工具提供证据" if calls else "结束工具选择，进入证据回答")}


def tool_step(state: State) -> State:
    existing = list(state.get("evidence", []))
    events = state.get("trace", [])
    steps = state.get("steps", 0)
    for call in state.get("proposed_tools", [])[:2]:
        if steps >= 6 or time.time() > state["deadline"]:
            break
        name, args = call["name"], call["args"]
        steps += 1  # Rejected and failed attempts also consume the loop budget.
        if name not in ALLOWED or not isinstance(args, dict):
            events = [*events, {"step": "tool", "status": "rejected", "name": name, "at": time.time()}]
            break
        start = time.monotonic()
        try:
            if name == "list_my_orders":
                data = mcp_call(name, {"service_token": state["token"]})
                evidence = {"id": "authorized-orders", "kind": "order-list", "data": data}
            elif name == "get_order_progress":
                order_id = args.get("order_id")
                listed = next((item["data"] for item in existing if item["kind"] == "order-list"), [])
                if not isinstance(order_id, str) or order_id not in {item["orderId"] for item in listed}:
                    raise ValueError("Order ID must come from authorized list")
                data = mcp_call(name, {"order_id": order_id, "service_token": state["token"]})
                evidence = {"id": "order:" + order_id, "kind": "order", "data": data}
            else:
                query = args.get("query")
                if not isinstance(query, str) or not query.strip() or len(query) > 500:
                    raise ValueError("Invalid knowledge query")
                if is_material_change_query(state.get("rewritten_question", state["question"])):
                    # Separate the knowledge question from the order lookup; the
                    # model cannot redirect this question to an unrelated topic.
                    query = knowledge_query(state.get("rewritten_question", state["question"]))
                data = mcp_call(name, {"query": query})
                evidence = {"id": "knowledge-search", "kind": "knowledge", "data": data}
            existing = [item for item in existing if item["id"] != evidence["id"]] + [evidence]
            safe_args = {key: args[key] for key in ("query", "order_id") if key in args}
            if name == "search_knowledge":
                safe_args["query"] = query
            preview = ([{"id": item["id"], "title": item["title"], "content": item["content"], "source": item["source"], "status": item.get("status")} for item in data[:8]] if name == "search_knowledge" else
                       [{"identifier": item["identifier"], "stage": item["stage"]} for item in data[:8]] if name == "list_my_orders" else
                       {key: data[key] for key in ("identifier", "stage", "queriedAt")})
            events = [*events, {"step": "tool", "status": "ok", "name": name, "at": time.time(), "durationMs": round((time.monotonic() - start) * 1000), "resultCount": len(data) if isinstance(data, list) else 1, "args": safe_args, "result": preview}]
        except Exception as exc:
            events = [*events, {"step": "tool", "status": "failed", "name": name, "at": time.time(), "durationMs": round((time.monotonic() - start) * 1000), "errorType": type(exc).__name__}]
            break
    return {"evidence": existing, "steps": steps, "trace": events}


def route_after_decision(state: State) -> str:
    return "tools" if state.get("proposed_tools") else "answer"


def _factual_answer(state: State) -> tuple[str, list[str]]:
    orders = [item for item in state.get("evidence", []) if item["kind"] == "order"]
    knowledge = [item for item in state.get("evidence", []) if item["kind"] == "knowledge"]
    if is_material_change_query(state["question"]):
        snippets = knowledge[-1]["data"] if knowledge else []
        change_matches = [item for item in snippets if item.get("evidence_type") == "user_provided_company_rule"]
        lines = [orders[-1]["data"]["identifier"] + " 当前为「" + orders[-1]["data"]["stage"] + "」。"] if orders else []
        if change_matches:
            lines.append("关于能否换颜色，以下是待公司审核的本地规则草稿，尚不能作为这笔订单的最终变更结论：")
            lines.extend(item["content"] + "〔" + item["id"] + "〕" for item in change_matches)
            lines.append("请由员工核对这笔订单的设计确认版本、采购与生产状态，再确认是否可受理变更、费用和交期影响。")
            return "\n".join(lines), ([orders[-1]["id"]] if orders else []) + [item["id"] for item in change_matches]
        lines.append("目前没有足够的相关规则证据判断这笔订单能否改色，请转人工核对设计版本和采购状态。")
        return "\n".join(lines), [orders[-1]["id"]] if orders else []
    if orders:
        progress = orders[-1]["data"]
        lines = [progress["identifier"] + " 当前为「" + progress["stage"] + "」。"]
        for area in progress["areas"]:
            routes = "、".join(route["kind"] + ("已完成" if route["completed"] else "进行中" if route["released"] else "尚未开放") for route in area["routes"])
            lines.append(area["name"] + "：" + (routes or "暂无路线记录") + "。")
        if progress["shipments"]:
            dates = "、".join(item["deliveredDate"] for item in progress["shipments"])
            lines.append("已登记的发货日期：" + dates + "。")
        else:
            lines.append("系统暂无已登记的发货记录，无法确认具体发货日期。")
        sources = [orders[-1]["id"]]
        if knowledge and knowledge[-1]["data"]:
            topic = ("售后" if re.search(r"售后|保修|报修", state["question"]) else
                     "材料" if re.search(r"清洁|保养|酒精", state["question"]) else
                     "订单进度" if re.search(r"发货|交付日期|什么时候送", state["question"]) else None)
            matches = [item for item in knowledge[-1]["data"] if item.get("category") == topic][:1] if topic else []
            lines.extend(item["content"] + "〔" + item["id"] + "〕" for item in matches)
            sources.extend(item["id"] for item in matches)
        return "\n".join(lines), sources
    lists = [item for item in state.get("evidence", []) if item["kind"] == "order-list"]
    if lists and len(lists[-1]["data"]) > 1:
        labels = "、".join(item["identifier"] for item in lists[-1]["data"][:8])
        return "您有多笔已授权订单，请选择要查询的一笔：" + labels, ["authorized-orders"]
    if lists and not lists[-1]["data"]:
        return "目前没有已授权可查看的订单。若您有订单，请联系相关员工核对绑定。", ["authorized-orders"]
    if knowledge and knowledge[-1]["data"]:
        matches = knowledge[-1]["data"][:2]
        return "\n".join(item["content"] + "〔" + item["id"] + "〕" for item in matches), [item["id"] for item in matches]
    return "目前没有足够的已核实资料回答这个问题。您可以提交人工请求。", []


def answer(state: State) -> State:
    safe_answer, sources = _factual_answer(state)
    llm = model()
    # For the first demo, ERP facts stay in deterministic prose. The model may
    # phrase retrieved knowledge, but validation will fall back to source text.
    has_pending = any(item.get("status") == "pending_company_review" for evidence in state.get("evidence", []) if evidence["kind"] == "knowledge" for item in evidence["data"])
    if llm and sources and not has_pending and not any(item["kind"] == "order" for item in state.get("evidence", [])):
        try:
            matches = [item for item in state.get("evidence", []) if item["kind"] == "knowledge"]
            if matches and matches[-1]["data"]:
                evidence = json.dumps(matches[-1]["data"][:3], ensure_ascii=False)
                response = llm.invoke([
                    SystemMessage(content="只根据所给片段用中文回答。每个业务结论须标注片段ID，格式〔ID〕。不得添加片段中没有的日期、费用、承诺或适用范围。无法回答则说资料不足。"),
                    HumanMessage(content="问题：" + state["question"] + "\n证据：" + evidence),
                ])
                draft = str(response.content)
                llm_runtime.update(lastSuccessAt=time.time(), lastErrorType=None)
                return {"answer": draft, "sources": sources, "trace": trace(state, "answer", "model_draft")}
        except Exception as exc:
            llm_runtime["lastErrorType"] = type(exc).__name__
            return {"answer": safe_answer, "sources": sources, "trace": trace(state, "answer", "fallback", engine="fallback", errorType=type(exc).__name__)}
    return {"answer": safe_answer, "sources": sources, "trace": trace(state, "answer", "factual")}


def validate(state: State) -> State:
    answer_text = state.get("answer", "")
    fallback, fallback_sources = _factual_answer(state)
    allowed_sources = set(state.get("sources", []))
    cited = set(re.findall(r"〔([^〕]+)〕", answer_text))
    evidence_text = json.dumps(state.get("evidence", []), ensure_ascii=False)
    novel_numbers = [number for number in re.findall(r"\d+(?:\.\d+)?", answer_text) if number not in evidence_text]
    safe = bool(answer_text.strip()) and cited.issubset(allowed_sources) and not novel_numbers
    if any(item["kind"] == "knowledge" and item["data"] for item in state.get("evidence", [])) and not cited:
        safe = False
    if any(event.get("step") == "answer" and event.get("status") == "model_draft" for event in state.get("trace", [])):
        # A citation alone is not evidence that every generated claim is supported.
        # Until a separate entailment verifier is calibrated, only exact approved
        # source spans may pass; otherwise use the deterministic extractive answer.
        approved = [item["content"] for evidence in state.get("evidence", []) if evidence["kind"] == "knowledge" for item in evidence["data"]]
        claims = [re.sub(r"〔[^〕]+〕", "", part).strip(" 。；;\n") for part in re.split(r"[。；;\n]", answer_text)]
        if any(claim and not any(claim in source for source in approved) for claim in claims):
            safe = False
    if not safe:
        return {"answer": fallback, "sources": fallback_sources, "trace": trace(state, "validate", "fallback")}
    return {"trace": trace(state, "validate", "passed")}


def route_after_validation(state: State) -> str:
    return "handoff" if re.search(r"转人工|人工处理|找客服|人工客服", state["question"]) else "finish"


def handoff(state: State) -> State:
    linked = next((item["data"]["orderId"] for item in state.get("evidence", []) if item["kind"] == "order"), "")
    key = "agent-" + state["thread_id"] + "-" + hashlib.sha256(state["question"].encode()).hexdigest()[:12]
    try:
        ticket = mcp_call("create_support_request", {"service_token": state["token"], "question": state["question"], "idempotency_key": key, "order_id": linked})
        return {"answer": state["answer"] + "\n已提交人工请求，编号 " + ticket["id"] + "。", "trace": trace(state, "handoff", "created", requestId=ticket["id"])}
    except Exception:
        return {"answer": state["answer"] + "\n人工请求暂未提交成功，请使用页面上的转人工按钮。", "trace": trace(state, "handoff", "failed")}


def finish(state: State) -> State:
    full_history = [*state.get("history", []), {
        "user": state["question"], "assistant": state.get("answer", ""),
        "orderId": next((item["data"]["orderId"] for item in state.get("evidence", []) if item["kind"] == "order"), None),
    }]
    summary = state.get("summary", "")
    if len(full_history) > 8:
        old = full_history[:-8]
        topics = []
        for turn in old:
            query = turn.get("user", "")
            topics.extend(topic for pattern, topic in ((r"订单|进度|发货|安装", "订单进度"), (r"材料|保养|清洁", "材料保养"), (r"售后|保修", "售后")) if re.search(pattern, query))
        summary = "此前咨询主题：" + "、".join(dict.fromkeys([*re.findall(r"订单进度|材料保养|售后", summary), *topics]))[:120]
    return {"history": full_history[-8:], "summary": summary, "status": "complete", "trace": trace(state, "finish", "complete")}


def make_graph(checkpointer):
    builder = StateGraph(State)
    for name, fn in (("prepare", prepare), ("decide", decide), ("tools", tool_step), ("answer", answer), ("validate", validate), ("handoff", handoff), ("finish", finish)):
        builder.add_node(name, fn)
    builder.add_edge(START, "prepare")
    builder.add_edge("prepare", "decide")
    builder.add_conditional_edges("decide", route_after_decision, {"tools": "tools", "answer": "answer"})
    builder.add_edge("tools", "decide")
    builder.add_edge("answer", "validate")
    builder.add_conditional_edges("validate", route_after_validation, {"handoff": "handoff", "finish": "finish"})
    builder.add_edge("handoff", "finish")
    builder.add_edge("finish", END)
    return builder.compile(checkpointer=checkpointer)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global saver_context, graph
    index.setup()
    # Fail startup on incomplete local weights and pay the cold-load cost before requests.
    if os.environ.get("CUSTOMER_ENABLE_DENSE") == "true":
        index._load_model()
    if os.environ.get("CUSTOMER_ENABLE_RERANK") == "true":
        index._rerank("模型预热", [{"title": "测试片段", "content": "仅在本机启动时预热"}])
    saver_context = PostgresSaver.from_conn_string(DATABASE_URL)
    saver = saver_context.__enter__()
    saver.setup()
    graph = make_graph(saver)
    try:
        yield
    finally:
        saver_context.__exit__(None, None, None)


app = FastAPI(title="Local Customer Agent Demo", lifespan=lifespan)


class RuntimeInput(BaseModel):
    serviceToken: str = Field(max_length=1000)


@app.post("/runtime")
def runtime(request: RuntimeInput):
    try:
        erp_get("/api/v1/customer-internal/orders", request.serviceToken)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid service context") from exc
    return {
        "llmConfigured": bool(os.environ.get("DEEPSEEK_API_KEY")),
        "model": os.environ.get("DEEPSEEK_MODEL", "deepseek-flash"),
        "llm": llm_runtime,
        "denseEnabled": os.environ.get("CUSTOMER_ENABLE_DENSE") == "true",
        "denseLoaded": index.model is not None,
        "rerankEnabled": os.environ.get("CUSTOMER_ENABLE_RERANK") == "true",
        "rerankLoaded": index.reranker is not None,
        "activeChunks": sum(item["audience"] == "customer" for item in index.items),
        "previewChunks": sum(item.get("evidence_type") == "user_provided_company_rule" for item in index.items),
        "mixedSearchChunks": len(index.items),
        "reviewChunks": sum(item["audience"] == "reviewer" for item in index.items),
        "vectorizedChunks": index.indexed_count(),
        "memory": "PostgreSQL / LangGraph checkpoints",
        "environment": "local_demo",
    }


@app.post("/run")
def run(request: RunInput):
    if len(request.serviceToken) > 1000:
        raise HTTPException(status_code=401, detail="Invalid service context")
    try:
        orders = erp_get("/api/v1/customer-internal/orders", request.serviceToken)
        payload = json.loads(__import__("base64").urlsafe_b64decode(request.serviceToken.split(".")[0] + "=="))
        customer_id = payload["customerId"]
        if not isinstance(orders, list) or not isinstance(customer_id, str):
            raise ValueError()
        thread_id = str(UUID(request.threadId)) if request.threadId else str(uuid4())
        result = graph.invoke(
            {"question": request.question, "token": request.serviceToken, "customer_id": customer_id, "thread_id": thread_id, "trace": [], "status": "running", "answer": "", "sources": []},
            config={"configurable": {"thread_id": customer_id + ":" + thread_id}},
        )
        return {"threadId": thread_id, "answer": result["answer"], "sources": result.get("sources", []), "trace": result.get("trace", [])}
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=401 if exc.response.status_code in (401, 403) else 503, detail="ERP authorization or tool unavailable") from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Agent unavailable") from exc


@app.post("/stream")
def stream(request: RunInput):
    if len(request.serviceToken) > 1000:
        raise HTTPException(status_code=401, detail="Invalid service context")
    try:
        orders = erp_get("/api/v1/customer-internal/orders", request.serviceToken)
        payload = json.loads(__import__("base64").urlsafe_b64decode(request.serviceToken.split(".")[0] + "=="))
        customer_id = payload["customerId"]
        if not isinstance(orders, list) or not isinstance(customer_id, str):
            raise ValueError()
        thread_id = str(UUID(request.threadId)) if request.threadId else str(uuid4())
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid service context") from exc

    def events():
        last_trace = 0
        try:
            for state in graph.stream(
                {"question": request.question, "token": request.serviceToken, "customer_id": customer_id, "thread_id": thread_id, "trace": [], "status": "running", "answer": "", "sources": []},
                config={"configurable": {"thread_id": customer_id + ":" + thread_id}},
                stream_mode="values",
            ):
                current_trace = state.get("trace", [])
                for event in current_trace[last_trace:]:
                    yield "data: " + json.dumps({"type": "trace", "event": event}, ensure_ascii=False) + "\n\n"
                last_trace = len(current_trace)
                if state.get("status") == "complete":
                    yield "data: " + json.dumps({"type": "result", "threadId": thread_id, "answer": state["answer"], "sources": state.get("sources", [])}, ensure_ascii=False) + "\n\n"
        except Exception:
            yield "data: " + json.dumps({"type": "error", "message": "客服暂时无法回答，可提交人工请求"}, ensure_ascii=False) + "\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

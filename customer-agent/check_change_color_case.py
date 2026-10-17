"""Regression: a production-stage color change must not turn into aftersales advice."""
import os
import time
from unittest.mock import patch

os.environ["CUSTOMER_ENABLE_DENSE"] = "false"
os.environ["CUSTOMER_ENABLE_RERANK"] = "false"
os.environ.setdefault("CUSTOMER_AGENT_DATABASE_URL", "postgresql://localhost/whole_house_erp_customer_agent_demo")

from app import _factual_answer, decide
from knowledge import KnowledgeIndex, is_material_change_query, knowledge_query


question = "查询订单 TEST-SALES-CUSTOMER-01 的进度，我这笔订单里的柜子现在还可以换颜色吗"
index = KnowledgeIndex("postgresql://unused")
rewritten = knowledge_query(question)
assert "TEST-SALES" not in rewritten and "换颜色" in rewritten, rewritten
chunks = index.search(rewritten, limit=8, scope="local_demo")
assert "company-change-002" in {item["id"] for item in chunks}, [item["id"] for item in chunks]
assert any(item["id"].startswith("public-") for item in chunks), [item["id"] for item in chunks]
assert all(item["id"].startswith("demo-") for item in index.search(question, scope="customer"))

order = {
    "identifier": "TEST-SALES-CUSTOMER-01", "stage": "生产中", "areas": [], "shipments": [],
}
answer, sources = _factual_answer({"question": question, "evidence": [
    {"id": "order:sample", "kind": "order", "data": order},
    {"id": "knowledge-search", "kind": "knowledge", "data": chunks},
]})
assert "换颜色" in answer or "改色" in answer, answer
assert not any(term in answer for term in ("清洁", "保修", "售后")), answer
assert "company-change-002" in sources, sources

red_cabinet_question = "我的订单执行到哪里了，里面的柜子我可以换成红色的吗"
assert is_material_change_query(red_cabinet_question), red_cabinet_question
assert knowledge_query(red_cabinet_question) == "柜子我可以换成红色的吗", knowledge_query(red_cabinet_question)
assert not is_material_change_query("柜子安装后售后能换成红色吗")
red_cabinet_chunks = index.search(knowledge_query(red_cabinet_question), limit=8, scope="local_demo")
red_answer, red_sources = _factual_answer({"question": red_cabinet_question, "evidence": [
    {"id": "order:sample", "kind": "order", "data": {**order, "stage": "交付中"}},
    {"id": "knowledge-search", "kind": "knowledge", "data": red_cabinet_chunks},
]})
assert "待公司审核" in red_answer and "company-change-002" in red_sources, (red_answer, red_sources)

class RepeatedSearchModel:
    def __init__(self, tool_name="search_knowledge", args=None):
        self.tool_name = tool_name
        self.args = {"query": question} if args is None else args

    def bind_tools(self, _tools):
        return self

    def invoke(self, _messages):
        return type("ToolResponse", (), {"tool_calls": [{"name": self.tool_name, "args": self.args}]})()


with patch("app.model", return_value=RepeatedSearchModel()):
    decision = decide({
        "question": question, "rewritten_question": question,
        "evidence": [
            {"id": "authorized-orders", "kind": "order-list", "data": [{"orderId": "order-1", "identifier": "TEST-SALES-CUSTOMER-01"}]},
            {"id": "knowledge-search", "kind": "knowledge", "data": chunks},
        ],
        "history": [], "trace": [], "steps": 2, "deadline": time.time() + 30,
    })
assert decision["proposed_tools"] == [{"name": "get_order_progress", "args": {"order_id": "order-1"}}], decision
with patch("app.model", return_value=RepeatedSearchModel("get_order_progress", {"order_id": "order-1"})):
    decision = decide({
        "question": question, "rewritten_question": question,
        "evidence": [
            {"id": "order:order-1", "kind": "order", "data": order},
            {"id": "knowledge-search", "kind": "knowledge", "data": chunks},
        ],
        "history": [], "trace": [], "steps": 3, "deadline": time.time() + 30,
    })
assert decision["proposed_tools"] == [], decision
with patch("app.model", return_value=RepeatedSearchModel("list_my_orders", {})):
    decision = decide({
        "question": question, "rewritten_question": question,
        "evidence": [
            {"id": "authorized-orders", "kind": "order-list", "data": [{"orderId": "order-1", "identifier": "TEST-SALES-CUSTOMER-01"}]},
            {"id": "order:order-1", "kind": "order", "data": order},
            {"id": "knowledge-search", "kind": "knowledge", "data": chunks},
        ],
        "history": [], "trace": [], "steps": 3, "deadline": time.time() + 30,
    })
assert decision["proposed_tools"] == [], decision
print("Production-stage color-change retrieval and answer passed")

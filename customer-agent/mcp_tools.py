"""The customer tool boundary, implemented with the official MCP protocol SDK."""
import json
import os

import httpx
from mcp.server import MCPServer

from knowledge import KnowledgeIndex, is_material_change_query

ERP_URL = os.environ.get("CUSTOMER_ERP_URL", "http://127.0.0.1:3100")
if ERP_URL not in ("http://127.0.0.1:3100", "http://localhost:3100"):
    raise RuntimeError("MCP tools may only connect to the local ERP API")

mcp = MCPServer("Customer Demo Read-Only Tools")
knowledge_index: KnowledgeIndex | None = None


def configure(index: KnowledgeIndex):
    global knowledge_index
    knowledge_index = index


def _get(path: str, service_token: str) -> str:
    with httpx.Client(timeout=3) as client:
        response = client.get(ERP_URL + path, headers={"x-customer-service-token": service_token})
        response.raise_for_status()
        return json.dumps(response.json(), ensure_ascii=False)


@mcp.tool()
def list_my_orders(service_token: str) -> str:
    """List the current customer account's authorized orders only."""
    return _get("/api/v1/customer-internal/orders", service_token)


@mcp.tool()
def get_order_progress(order_id: str, service_token: str) -> str:
    """Read a single authorized customer's order progress projection."""
    if not order_id or "/" in order_id or len(order_id) > 100:
        raise ValueError("Invalid order ID")
    return _get("/api/v1/customer-internal/orders/" + order_id, service_token)


@mcp.tool()
def search_knowledge(query: str) -> str:
    """Search local knowledge; mixed change queries rank all indexed chunks."""
    if not knowledge_index or not query.strip() or len(query) > 500:
        raise ValueError("Invalid knowledge query")
    scope = "local_demo" if is_material_change_query(query) else "customer"
    return json.dumps(knowledge_index.search(query, limit=8, scope=scope), ensure_ascii=False)


@mcp.tool()
def create_support_request(service_token: str, question: str, idempotency_key: str, order_id: str = "") -> str:
    """Create one auditable human support request for the verified customer."""
    with httpx.Client(timeout=3) as client:
        response = client.post(
            ERP_URL + "/api/v1/customer-internal/support",
            headers={"x-customer-service-token": service_token},
            json={"question": question, "reason": "客户在智能客服中请求人工处理", "idempotencyKey": idempotency_key, **({"orderId": order_id} if order_id else {})},
        )
        response.raise_for_status()
        return json.dumps(response.json(), ensure_ascii=False)

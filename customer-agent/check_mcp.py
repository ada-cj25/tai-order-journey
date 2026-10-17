"""Smoke test the actual MCP tool listing and a knowledge call."""
import asyncio
import json
import os

from mcp import Client

from knowledge import KnowledgeIndex
from mcp_tools import configure, mcp


async def main():
    configure(KnowledgeIndex(os.environ.get("CUSTOMER_AGENT_DATABASE_URL", "postgresql://unused")))
    async with Client(mcp) as client:
        names = {tool.name for tool in (await client.list_tools()).tools}
        assert {"list_my_orders", "get_order_progress", "search_knowledge", "create_support_request"}.issubset(names)
        result = await client.call_tool("search_knowledge", {"query": "酒精清洁"})
        assert not result.is_error
        items = json.loads(result.content[0].text)
        assert any(item["id"] == "demo-material-care" for item in items)
        draft_result = await client.call_tool("search_knowledge", {"query": "设计交付后坚持换板材颜色，费用谁承担？"})
        assert not draft_result.is_error
        draft_items = json.loads(draft_result.content[0].text)
        assert "company-change-004" in {item["id"] for item in draft_items}
        assert any(item["status"] == "pending_company_review" for item in draft_items)
        assert len(draft_items) == 8, [item["id"] for item in draft_items]
    print("MCP tool discovery and knowledge call passed")


if __name__ == "__main__":
    asyncio.run(main())

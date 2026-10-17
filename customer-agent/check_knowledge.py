"""Verify draft boundaries and local lexical retrieval without model downloads."""
import os

from knowledge import KnowledgeIndex, knowledge_query, rrf


def main():
    os.environ["CUSTOMER_ENABLE_DENSE"] = "false"
    os.environ["CUSTOMER_ENABLE_RERANK"] = "false"
    index = KnowledgeIndex("postgresql://unused")
    review = [item for item in index.items if item["audience"] == "reviewer"]
    assert len(review) == 28
    assert all(item["status"] == "pending_company_review" and not item["active_for_answers"] for item in review)
    assert all(len(item["title"] + item["content"]) <= 500 for item in review)
    assert any(item["id"] == "company-change-004" for item in index.search("客户坚持换板材颜色费用谁承担", scope="review"))
    assert all(item["id"].startswith("demo-") for item in index.search("客户坚持换板材颜色费用谁承担"))
    query = knowledge_query("查询订单 TEST-SALES-CUSTOMER-01 的进度，我这笔订单里的柜子现在还可以换颜色吗？")
    full = index.inspect_search(query, limit=8, scope="local_demo")
    assert "company-change-002" in full["rankings"]["bm25"]
    assert any(item.startswith("public-") for item in full["rankings"]["bm25"])
    assert any(item.startswith("demo-") for item in full["rankings"]["bm25"])
    assert rrf(["a", "b"], ["b", "c"])[0] == "b"
    print("Knowledge scopes, draft metadata and RRF check passed")


if __name__ == "__main__":
    main()

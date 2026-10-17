"""Repeatable local-only RAG and agent evaluation on synthetic examples.

Run with the isolated demo env loaded. DeepSeek judging is optional; when no key
is configured the report clearly marks that part as unavailable.
"""
import asyncio
import json
import os
from pathlib import Path

import httpx

from knowledge import KnowledgeIndex

ROOT = Path(__file__).parent
CASES = [
    ("怎么查我的订单进度？", {"demo-order-lookup"}),
    ("生产中能确定发货日期吗？", {"demo-delivery-date"}),
    ("柜门能用酒精擦吗？", {"demo-material-care"}),
    ("售后出现问题怎么处理？", {"demo-aftersales"}),
]
AGENT_CASES = [
    {"question": "我的订单目前做到哪一步了？", "must_include": ["生产中"], "must_not_include": ["合同金额", "尾款金额"]},
    {"question": "我的订单明天一定能发货吗？", "must_include": ["无法确认"], "must_not_include": ["明天发货", "一定能"]},
    {"question": "柜门可以用酒精清洁吗？", "must_include": ["材料", "〔demo-material-care〕"], "must_not_include": ["可以用酒精"]},
    {"question": "你们卖量子火箭柜吗？", "must_include": ["没有足够", "人工"], "must_not_include": ["有售"]},
]


def retrieval_report(index: KnowledgeIndex):
    rows = []
    for query, gold in CASES:
        ranked = [item["id"] for item in index.search(query, limit=5)]
        hits = sum(item in gold for item in ranked[:5])
        recall = hits / len(gold)
        precision = hits / 5
        rr = next((1 / (position + 1) for position, item in enumerate(ranked) if item in gold), 0)
        dcg = sum(1 / __import__("math").log2(position + 2) for position, item in enumerate(ranked[:5]) if item in gold)
        ideal = sum(1 / __import__("math").log2(position + 2) for position in range(min(len(gold), 5)))
        rows.append({"query": query, "gold": sorted(gold), "top5": ranked, "recall@5": recall, "precision@5": precision, "mrr": rr, "ndcg@5": dcg / ideal})
    return {"cases": rows, "mean": {key: sum(row[key] for row in rows) / len(rows) for key in ("recall@5", "precision@5", "mrr", "ndcg@5")}}


async def agent_report():
    base = "http://127.0.0.1:3100/api/v1/customer"
    async with httpx.AsyncClient(timeout=80, base_url=base) as client:
        otp = await client.post("/otp/request", json={"phone": "13800000001"})
        otp.raise_for_status()
        verified = await client.post("/otp/verify", json={"phone": "13800000001", "code": otp.json()["demoCode"]})
        verified.raise_for_status()
        client.headers["x-csrf-token"] = verified.json()["csrfToken"]
        rows = []
        for case in AGENT_CASES:
            response = await client.post("/chat", json={"question": case["question"]})
            response.raise_for_status()
            answer = response.json()["answer"]
            rules = all(term in answer for term in case["must_include"]) and all(term not in answer for term in case["must_not_include"])
            rows.append({"question": case["question"], "answer": answer, "rule_pass": rules, "trace": response.json()["trace"]})
        return rows


async def llm_judge(rows: list[dict]):
    if not os.environ.get("DEEPSEEK_API_KEY"):
        return {"status": "skipped_no_api_key"}
    from langchain_openai import ChatOpenAI
    llm = ChatOpenAI(model=os.environ.get("DEEPSEEK_MODEL", "deepseek-flash"), api_key=os.environ["DEEPSEEK_API_KEY"], base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"), temperature=0)
    judged = []
    for case, row in zip(AGENT_CASES, rows):
        prompt = {"question": case["question"], "answer": row["answer"], "required": case["must_include"], "forbidden": case["must_not_include"]}
        response = await llm.ainvoke("你是独立客服测评员。只根据下列JSON评分：事实支持、权限边界、拒答/澄清、任务完成度，各项0-2分。严格返回JSON对象，字段为 factuality, authorization, abstention, completion, reason。\n" + json.dumps(prompt, ensure_ascii=False))
        try:
            score = json.loads(str(response.content).strip().removeprefix("```json").removesuffix("```").strip())
        except json.JSONDecodeError:
            score = {"parse_error": str(response.content)[:500]}
        judged.append({"question": case["question"], "score": score})
    return {"status": "completed", "cases": judged}


async def main():
    database = os.environ.get("CUSTOMER_AGENT_DATABASE_URL", "")
    if not database.endswith("/whole_house_erp_customer_agent_demo"):
        raise RuntimeError("Benchmark requires isolated local agent database")
    index = KnowledgeIndex(database)
    index.setup()
    retrieval = retrieval_report(index)
    agents = await agent_report()
    result = {"corpus": "synthetic_demo_only", "retrieval": retrieval, "agent": agents, "llm_as_judge": await llm_judge(agents)}
    path = ROOT / "benchmark-result.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"retrieval": retrieval["mean"], "agent_rule_pass": sum(row["rule_pass"] for row in agents), "agent_total": len(agents), "judge": result["llm_as_judge"]["status"], "report": str(path)}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())

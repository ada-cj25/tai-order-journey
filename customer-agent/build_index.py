"""Build or inspect the isolated local knowledge index; caller supplies validated env."""
import argparse
import json
import os
import time
from urllib.parse import urlparse

from knowledge import KnowledgeIndex


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", action="append", help="Inspect retrieval for one or more queries")
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--scope", choices=("customer", "review", "local_demo"), default="review")
    parser.add_argument("--summary", action="store_true", help="Print rankings as IDs only")
    args = parser.parse_args()
    url = os.environ.get("CUSTOMER_AGENT_DATABASE_URL", "")
    parsed = urlparse(url)
    if parsed.hostname not in ("localhost", "127.0.0.1", "::1") or parsed.path != "/whole_house_erp_customer_agent_demo":
        raise SystemExit("Refusing nonlocal or non-demo knowledge database")
    index = KnowledgeIndex(url)
    index.setup()
    build_start = time.monotonic()
    index._load_model()
    if args.query:
        if os.environ.get("CUSTOMER_ENABLE_RERANK") == "true":
            index._rerank("模型预热", [{"title": "测试片段", "content": "仅在本机预热"}])
        for query in args.query:
            query_start = time.monotonic()
            result = index.inspect_search(query, limit=args.limit, scope=args.scope)
            result["queryMs"] = round((time.monotonic() - query_start) * 1000)
            if args.summary:
                result["results"] = [item["id"] for item in result["results"]]
            print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(json.dumps({
            "indexed": len(index.vectors),
            "reviewChunks": sum(item["audience"] == "reviewer" for item in index.items),
            "customerChunks": sum(item["audience"] == "customer" for item in index.items),
            "embeddingModel": "BAAI/bge-m3" if index.model is not None else "disabled",
            "buildMs": round((time.monotonic() - build_start) * 1000),
        }, ensure_ascii=False))


if __name__ == "__main__":
    main()

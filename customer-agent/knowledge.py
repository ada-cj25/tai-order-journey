"""Isolated local knowledge index with publication-aware retrieval scopes."""
import hashlib
import json
import os
import re
from datetime import date
from pathlib import Path

import jieba
import numpy as np
import psycopg
from rank_bm25 import BM25Okapi

KNOWLEDGE_DIR = Path(__file__).parent / "knowledge"
CORPUS = KNOWLEDGE_DIR / "demo.json"
REVIEW_DIR = KNOWLEDGE_DIR / "review"
EMBEDDING_MODEL_ID = "BAAI/bge-m3"
RERANK_MODEL_ID = "BAAI/bge-reranker-v2-m3"


def is_material_change_query(query: str) -> bool:
    """Recognize material/color changes, including named colors such as 红色."""
    if re.search(r"售后|保修|报修|维修|退货|安装后", query):
        return False
    has_change = any(term in query for term in ("换", "改", "变更", "调整"))
    has_target = any(term in query for term in ("颜色", "色号", "板材", "改色", "换色")) or bool(
        re.search(r"[\u4e00-\u9fff]{1,4}色", query)
    )
    return has_change and has_target


def knowledge_query(query: str) -> str:
    """Remove order-lookup noise from a mixed order/policy question."""
    rewritten = re.sub(r"查询订单\s*[A-Za-z0-9_-]+\s*的进度[，,。；;]?\s*", "", query)
    rewritten = re.sub(r"^(?:我(?:的)?订单|这笔订单)(?:目前|现在)?(?:执行到哪里了|进行到哪一步了|做到哪一步了|进度如何|是什么进度)[，,。；;]?\s*", "", rewritten)
    rewritten = re.sub(r"^(?:里面的|(?:我)?这笔订单里(?:面)?的?)", "", rewritten)
    return rewritten.strip() or query


def _tokens(text: str) -> list[str]:
    return [word.strip().lower() for word in jieba.cut(text) if word.strip()]


def rrf(first: list[str], second: list[str], constant: int = 60) -> list[str]:
    scores: dict[str, float] = {}
    for ranking in (first, second):
        for rank, item in enumerate(ranking, 1):
            scores[item] = scores.get(item, 0.0) + 1.0 / (constant + rank)
    return sorted(scores, key=lambda item: scores[item], reverse=True)


class KnowledgeIndex:
    def __init__(self, database_url: str):
        self.database_url = database_url
        approved = [item for item in json.loads(CORPUS.read_text()) if item["status"] == "approved_demo" and item["audience"] == "customer"]
        review: list[dict] = []
        for path in sorted(REVIEW_DIR.glob("*.json")):
            document = json.loads(path.read_text())
            if not isinstance(document, dict) or not isinstance(document.get("chunks"), list):
                continue
            sources = {source["id"]: source for source in document.get("sources", [])}
            for chunk in document["chunks"]:
                if chunk.get("status") != "pending_company_review" or chunk.get("audience") != "reviewer" or chunk.get("active_for_answers") is not False:
                    raise ValueError(f"Review chunk has unsafe publication state: {chunk.get('id')}")
                if len(chunk["title"] + chunk["content"]) > 500:
                    raise ValueError(f"Review chunk exceeds 500 characters: {chunk['id']}")
                source_labels = [sources[source_id]["publisher"] for source_id in chunk.get("source_ids", []) if source_id in sources]
                origin = "用户提供的公司规则草稿" if chunk.get("evidence_type") == "user_provided_company_rule" else "待公司审核的拟议流程"
                review.append({**chunk, "source": "、".join(source_labels) or origin, "review_file": path.name})
        self.items = approved + review
        self.by_id = {item["id"]: item for item in self.items}
        if len(self.by_id) != len(self.items):
            raise ValueError("Duplicate knowledge chunk IDs")
        self.model = None
        self.reranker = None
        self.vectors: dict[str, list[float]] = {}
        self._vectors_ready = False

    def setup(self):
        with psycopg.connect(self.database_url) as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS customer_demo_knowledge_vector "
                "(id TEXT PRIMARY KEY, model TEXT NOT NULL, version TEXT NOT NULL, embedding JSONB NOT NULL, content_hash TEXT)"
            )
            conn.execute("ALTER TABLE customer_demo_knowledge_vector ADD COLUMN IF NOT EXISTS content_hash TEXT")

    def indexed_count(self) -> int:
        with psycopg.connect(self.database_url) as conn:
            rows = conn.execute("SELECT id,content_hash FROM customer_demo_knowledge_vector WHERE model=%s", (EMBEDDING_MODEL_ID,)).fetchall()
        return sum(item_id in self.by_id and content_hash == self._content_hash(self.by_id[item_id]) for item_id, content_hash in rows)

    @staticmethod
    def _content(item: dict) -> str:
        return item["title"] + " " + item["content"]

    @classmethod
    def _content_hash(cls, item: dict) -> str:
        return hashlib.sha256(cls._content(item).encode("utf-8")).hexdigest()

    def _load_model(self):
        if os.environ.get("CUSTOMER_ENABLE_DENSE") != "true":
            return
        if self._vectors_ready:
            return
        if self.model is None:
            from FlagEmbedding import BGEM3FlagModel
            model_path = os.environ.get("CUSTOMER_EMBEDDING_MODEL_PATH", str(Path(__file__).parent / ".models" / "bge-m3"))
            if not Path(model_path).is_dir():
                raise RuntimeError(f"Local embedding model is missing: {model_path}")
            self.model = BGEM3FlagModel(model_path, use_fp16=False)
        with psycopg.connect(self.database_url) as conn:
            missing = []
            for item in self.items:
                row = conn.execute(
                    "SELECT embedding FROM customer_demo_knowledge_vector WHERE id=%s AND model=%s AND version=%s AND content_hash=%s",
                    (item["id"], EMBEDDING_MODEL_ID, item["version"], self._content_hash(item)),
                ).fetchone()
                if row is not None:
                    self.vectors[item["id"]] = row[0]
                    continue
                missing.append(item)
            if not missing:
                self._vectors_ready = True
                return
            embeddings = self.model.encode([self._content(item) for item in missing], batch_size=4, return_dense=True, return_sparse=False, return_colbert_vecs=False)["dense_vecs"]
            for item, vector in zip(missing, embeddings):
                vector = vector / np.linalg.norm(vector)
                numbers = vector.tolist()
                conn.execute(
                    "INSERT INTO customer_demo_knowledge_vector (id,model,version,embedding,content_hash) VALUES (%s,%s,%s,%s,%s) "
                    "ON CONFLICT (id) DO UPDATE SET model=EXCLUDED.model, version=EXCLUDED.version, embedding=EXCLUDED.embedding, content_hash=EXCLUDED.content_hash",
                    (item["id"], EMBEDDING_MODEL_ID, item["version"], json.dumps(numbers), self._content_hash(item)),
                )
                self.vectors[item["id"]] = numbers
            self._vectors_ready = True

    def _rerank(self, query: str, items: list[dict]) -> list[dict]:
        if os.environ.get("CUSTOMER_ENABLE_RERANK") != "true" or not items:
            return items
        if self.reranker is None:
            from FlagEmbedding import FlagReranker
            model_path = os.environ.get("CUSTOMER_RERANK_MODEL_PATH", str(Path(__file__).parent / ".models" / "bge-reranker-v2-m3"))
            if not Path(model_path).is_dir():
                raise RuntimeError(f"Local reranker model is missing: {model_path}")
            self.reranker = FlagReranker(model_path, use_fp16=False)
        pairs = [[query, item["title"] + " " + item["content"]] for item in items]
        scores = self.reranker.compute_score(pairs)
        if isinstance(scores, (float, int)):
            scores = [scores]
        return [item for _, item in sorted(zip(scores, items), key=lambda pair: pair[0], reverse=True)]

    def _retrieve(self, query: str, limit: int, scope: str) -> tuple[list[dict], dict]:
        if scope not in ("customer", "review", "local_demo"):
            raise ValueError("Unknown knowledge retrieval scope")
        if not query.strip() or not self.items:
            return [], {"bm25": [], "dense": [], "rrf": [], "rerank": []}
        today = date.today().isoformat()
        def in_scope(item: dict) -> bool:
            if scope == "local_demo":
                return item["audience"] in ("reviewer", "customer")
            if scope == "review":
                return item["audience"] == "reviewer" and item["status"] == "pending_company_review"
            return item["audience"] == "customer" and item["status"] == "approved_demo"

        eligible = [item for item in self.items if in_scope(item)
                    and (not item.get("effective_from") or item["effective_from"] <= today)
                    and (not item.get("effective_to") or item["effective_to"] >= today)]
        if not eligible:
            return [], {"bm25": [], "dense": [], "rrf": [], "rerank": []}
        bm25 = BM25Okapi([_tokens(self._content(item)) for item in eligible])
        scores = bm25.get_scores(_tokens(query))
        bm25_ids = [eligible[i]["id"] for i in np.argsort(scores)[::-1][:20] if scores[i] > 0]
        dense_ids: list[str] = []
        if os.environ.get("CUSTOMER_ENABLE_DENSE") == "true":
            self._load_model()
            vector = self.model.encode([query], return_dense=True, return_sparse=False, return_colbert_vecs=False)["dense_vecs"][0]
            vector = vector / np.linalg.norm(vector)
            dense_ids = sorted((item["id"] for item in eligible), key=lambda item_id: float(np.dot(vector, self.vectors[item_id])), reverse=True)[:20]
        ranked = rrf(bm25_ids, dense_ids) if dense_ids else bm25_ids
        candidates = self._rerank(query, [self.by_id[item_id] for item_id in ranked[:20]])
        fields = ("id", "title", "content", "source", "version", "category") if scope == "customer" else (
            "id", "title", "content", "source", "version", "category", "evidence_type", "source_ids", "owner_department", "company_questions", "status")
        result = [{key: item.get(key) for key in fields} for item in candidates[:limit]]
        trace = {"bm25": bm25_ids, "dense": dense_ids, "rrf": ranked, "rerank": [item["id"] for item in candidates]}
        return result, trace

    def search(self, query: str, limit: int = 5, scope: str = "customer") -> list[dict]:
        return self._retrieve(query, limit, scope)[0]

    def inspect_search(self, query: str, limit: int = 5, scope: str = "review") -> dict:
        """Local reviewer diagnostics; this is not registered as a customer MCP tool."""
        items, trace = self._retrieve(query, limit, scope)
        return {"query": query, "scope": scope, "rankings": trace, "results": items}

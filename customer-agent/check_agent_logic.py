"""Focused checks for ambiguous orders, reference resolution and memory compression."""
from app import _local_decision, finish

orders = [
    {"orderId": "one", "identifier": "TEST-SALES-ONE", "trackingSerial": "TEST-DEMO-ONE"},
    {"orderId": "two", "identifier": "TEST-SALES-TWO", "trackingSerial": "TEST-DEMO-TWO"},
]
evidence = [{"kind": "order-list", "id": "authorized-orders", "data": orders}]

assert _local_decision({"question": "我的订单进度？", "evidence": evidence, "history": []}) == []
assert _local_decision({"question": "TEST-SALES-TWO 这个订单进度？", "evidence": evidence, "history": []}) == [
    {"name": "get_order_progress", "args": {"order_id": "two"}},
]
assert _local_decision({"question": "那一单现在怎么样？", "evidence": evidence, "history": [{"orderId": "one"}]}) == [
    {"name": "get_order_progress", "args": {"order_id": "one"}},
]
assert _local_decision({"question": "那一单现在怎么样？", "evidence": evidence, "history": [{"orderId": "revoked"}]}) == []

state = {"question": "材料如何保养？", "answer": "请核对材料。", "history": [{"user": "订单进度如何？", "assistant": "已核对。"}] * 8, "trace": [], "evidence": []}
result = finish(state)
assert len(result["history"]) == 8
assert result["summary"] == "此前咨询主题：订单进度"
assert "已核对" not in result["summary"]
print("Agent ambiguity, reference and memory checks passed")

# Tool failures and unknown tool names must not create an unbounded retry loop.
import time
import app
original_call = app.mcp_call
try:
    def unavailable(*args, **kwargs):
        raise TimeoutError('synthetic tool timeout')
    app.mcp_call = unavailable
    failed = app.tool_step({'token': 'synthetic', 'proposed_tools': [{'name': 'list_my_orders', 'args': {}}], 'steps': 3, 'deadline': time.time() + 30})
    assert failed['steps'] == 4 and failed['trace'][-1]['status'] == 'failed'
    assert app.decide({'steps': failed['steps'], 'deadline': time.time() + 30})['proposed_tools'] == []
    rejected = app.tool_step({'proposed_tools': [{'name': 'delete_order', 'args': {}}], 'steps': 0, 'deadline': time.time() + 30})
    assert rejected['steps'] == 1 and rejected['trace'][-1]['status'] == 'rejected'
finally:
    app.mcp_call = original_call
print('Failed/rejected tool budget checks passed')

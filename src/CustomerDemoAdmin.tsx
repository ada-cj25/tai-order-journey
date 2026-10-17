import { useEffect, useState } from "react";
import { Alert, Button, Card, Form, Input, List, Select, Space, Tabs, Tag, Typography, message } from "antd";

type OrderOption = { id: string; salesNumber?: string | null; trackingSerial: string; customerPhone?: string };
type SupportRequest = { id: string; question: string; reason: string; status: string; orderId?: string | null; createdAt: string; replies: Array<{ id: string; body: string }> };
type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

export function CustomerDemoAdmin({ api, orders, role }: { api: Api; orders: OrderOption[]; role: string }) {
  const [orderId, setOrderId] = useState<string>();
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("已核对客户预留手机号和订单归属");
  const [busy, setBusy] = useState(false);
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [replies, setReplies] = useState<Record<string, string>>({});

  async function reload() {
    if (!["ORDER_ADMIN", "CHAIRMAN"].includes(role)) return;
    setRequests(await api<SupportRequest[]>("/api/v1/customer-admin/support"));
  }
  useEffect(() => { reload().catch(() => undefined); }, [role]);

  async function grant() {
    if (!orderId || !/^1[3-9]\d{9}$/.test(phone) || !reason.trim()) { message.error("请选择订单并填写已验证手机号与绑定原因"); return; }
    setBusy(true);
    try {
      await api("/api/v1/customer-admin/orders/" + orderId + "/grants", { method: "POST", body: JSON.stringify({ phone, reason }) });
      message.success("订单已授权给该客户");
    } catch (error) { message.error(error instanceof Error ? error.message : "绑定失败"); }
    finally { setBusy(false); }
  }

  async function reply(id: string) {
    const text = replies[id]?.trim();
    if (!text) return;
    setBusy(true);
    try {
      await api("/api/v1/customer-admin/support/" + id + "/replies", { method: "POST", body: JSON.stringify({ text }) });
      setReplies((current) => ({ ...current, [id]: "" }));
      await reload();
      message.success("回复已发送");
    } catch (error) { message.error(error instanceof Error ? error.message : "回复失败"); }
    finally { setBusy(false); }
  }

  return <Tabs items={[
    { key: "grants", label: "确认客户订单绑定", children: <Card size="small">
      <Alert type="info" showIcon message="仅用于本地虚构数据 Demo。客户须先验证手机号；手机号与订单预留号码一致后才能绑定。" style={{ marginBottom: 16 }} />
      <Form layout="vertical">
        <Form.Item label="订单"><Select showSearch value={orderId} onChange={setOrderId} optionFilterProp="label" options={orders.map((order) => ({ value: order.id, label: (order.salesNumber ?? order.trackingSerial) + " · " + order.trackingSerial }))} /></Form.Item>
        <Form.Item label="客户已验证手机号"><Input value={phone} maxLength={11} onChange={(event) => setPhone(event.target.value)} placeholder="与订单预留号码一致" /></Form.Item>
        <Form.Item label="确认原因"><Input.TextArea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} /></Form.Item>
        <Button type="primary" loading={busy} onClick={grant}>确认绑定</Button>
      </Form>
    </Card> },
    ...(["ORDER_ADMIN", "CHAIRMAN"].includes(role) ? [{
      key: "support", label: "客服待办", children: <div><Button onClick={() => reload().catch(() => message.error("加载失败"))} style={{ marginBottom: 12 }}>刷新待办</Button><List
        dataSource={requests} locale={{ emptyText: "暂无待处理请求" }}
        renderItem={(item) => <List.Item><div style={{ width: "100%" }}>
          <Space wrap><Tag color="processing">待处理</Tag><Typography.Text strong>{item.question}</Typography.Text></Space>
          <p>转人工原因：{item.reason}</p>
          {item.replies.map((reply) => <p key={reply.id}>已回复：{reply.body}</p>)}
          <Space.Compact style={{ width: "100%" }}><Input value={replies[item.id] ?? ""} onChange={(event) => setReplies((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="给客户回复" /><Button disabled={busy} onClick={() => reply(item.id)}>发送回复</Button><Button disabled={busy} onClick={async () => { await api("/api/v1/customer-admin/support/" + item.id + "/close", { method: "POST" }); await reload(); }}>关闭</Button></Space.Compact>
        </div></List.Item>}
      /></div>,
    }] : []),
  ]} />;
}

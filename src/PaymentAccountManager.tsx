import { useState } from "react";
import { Alert, App as AntApp, Button, Empty, Form, Input, List, Modal, Space, Tag, Typography } from "antd";

export type PaymentAccount = {
  id: string;
  name: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewComment?: string | null;
  requestedAt: string;
  reviewedAt?: string | null;
};

type ApiCall = <T>(path: string, init?: RequestInit) => Promise<T>;

export function PaymentAccountManager({ open, role, accounts, api, onClose, onChanged }: { open: boolean; role: string; accounts: PaymentAccount[]; api: ApiCall; onClose: () => void; onChanged: () => Promise<void> }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const isFinance = role === "FINANCE";

  async function requestAccount({ name }: { name: string }) {
    setSaving(true);
    try {
      await api("/api/v1/payment-accounts", { method: "POST", body: JSON.stringify({ name }) });
      form.resetFields();
      await onChanged();
      message.success("申请已发送给董事长管理员；通过后才会出现在收款表单中");
    } catch (error) { message.error(error instanceof Error ? error.message : "提交失败"); }
    finally { setSaving(false); }
  }

  async function review(id: string, decision: "APPROVE" | "REJECT") {
    setSaving(true);
    try {
      await api(`/api/v1/payment-accounts/${id}/review`, { method: "POST", body: JSON.stringify({ decision }) });
      await onChanged();
      message.success(decision === "APPROVE" ? "账户已批准并立即可用" : "账户申请已驳回");
    } catch (error) { message.error(error instanceof Error ? error.message : "审批失败"); }
    finally { setSaving(false); }
  }

  return <Modal title={isFinance ? "收款账户申请" : "收款账户审批"} width={680} open={open} onCancel={onClose} footer={<Button onClick={onClose}>关闭</Button>} destroyOnHidden>
    <Alert type="info" showIcon title={isFinance ? "财务新增账户后会自动发送董事长审批；待审批和驳回账户不能用于任何收款报备。" : "只有批准状态的账户会出现在定金、预付款和尾款的收款账户选项中。"} />
    {isFinance && <Form form={form} layout="inline" onFinish={requestAccount} style={{ margin: "18px 0" }}>
      <Form.Item name="name" rules={[{ required: true, message: "请填写账户名称" }, { min: 2, max: 80 }]} style={{ flex: 1 }}><Input placeholder="例如：招商银行上海分行基本户" /></Form.Item>
      <Button type="primary" htmlType="submit" loading={saving}>提交审批</Button>
    </Form>}
    <Typography.Title level={5} style={{ marginTop: 18 }}>{role === "CHAIRMAN" ? "账户目录与待审批申请" : "账户目录与申请状态"}</Typography.Title>
    <List dataSource={accounts} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无收款账户" /> }} renderItem={(account) => <List.Item actions={role === "CHAIRMAN" && account.status === "PENDING" ? [<Button key="reject" danger disabled={saving} onClick={() => review(account.id, "REJECT")}>驳回</Button>, <Button key="approve" type="primary" loading={saving} onClick={() => review(account.id, "APPROVE")}>通过并启用</Button>] : undefined}>
      <List.Item.Meta title={<Space><strong>{account.name}</strong><Tag color={account.status === "APPROVED" ? "success" : account.status === "PENDING" ? "processing" : "error"}>{account.status === "APPROVED" ? "已启用" : account.status === "PENDING" ? "待审批" : "已驳回"}</Tag></Space>} description={account.reviewComment || (account.status === "PENDING" ? "等待董事长管理员审批" : "历史收款事实保留，目录状态只影响后续新报备")} />
    </List.Item>} />
  </Modal>;
}

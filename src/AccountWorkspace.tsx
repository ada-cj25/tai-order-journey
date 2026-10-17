import { useEffect, useState } from "react";
import { App, Alert, Button, Card, Form, Input, Modal, Select, Space, Switch, Table, Tag } from "antd";
import { assignedProcessCodes, workshopProcessOptions, WORKSHOP_LABELS } from "../server/domain/workshop-processes";

import { SALES_UNIT_LABELS, salesRoleLabel } from "../server/domain/sales-policy";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Account = { id: string; employeeNo: string; username: string; name: string; department: string; role: string; level: string; businessUnit?: string; workshop?: string; processCode?: string; processCodes?: string[]; active: boolean; updatedAt: string };
type MiniAccount = Pick<Account, "id" | "employeeNo" | "name" | "department" | "role" | "level" | "active"> & { bindingStatus: "BOUND" | "INVITED" | "UNBOUND"; boundAt?: string | null; inviteExpiresAt?: string | null };
const roles = { CHAIRMAN: "董事长管理员", ORDER_ADMIN: "订单管理员", FINANCE: "财务", SALES: "销售", DESIGNER: "设计师", TECHNICAL: "技术拆单", PROCUREMENT: "采购", WORKSHOP: "车间", INSTALLER: "安装", AFTERSALES: "售后" };

export function NumberReservations({ api }: { api: Api }) {
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState<Array<{ id: string; createdAt: string; metadata: { number: string; reason: string } }>>([]);
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const categories = { NOERLI_FORMAL: "诺尔丽正单", NOERLI_SUPPLEMENT: "诺尔丽补单", AIKEJU_FORMAL: "艾可居正单", AIKEJU_SUPPLEMENT: "艾可居补单", CHANNEL_FORMAL: "渠道正单", CHANNEL_SUPPLEMENT: "渠道补单", ENGINEERING_FORMAL: "工程正单", ENGINEERING_SUPPLEMENT: "工程补单", WORKWEAR_FORMAL: "工装正单", WORKWEAR_SUPPLEMENT: "工装补单" };
  async function load() { setRows(await api("/api/v1/admin/number-reservations")); }
  useEffect(() => { load().catch((error) => message.error(error.message)); }, [api]);
  return <Card title="旧流程编号预留">
    <Alert type="warning" showIcon title="仅用于仍在旧流程办理的订单/补单。预留后永久占用本月同分类流水，不能撤销或复用。ERP订单在设计正式提交时自动编号，无需在此预留。" />
    <Form form={form} layout="inline" style={{ margin: "20px 0" }} onFinish={(values) => modal.confirm({ title: "确认占用一个生产编号？", content: "请先核对旧流程登记信息。该操作不会创建ERP订单，也不会迁移旧订单。", onOk: async () => {
      setBusy(true);
      try { const result = await api<{ number: string }>("/api/v1/admin/number-reservations", { method: "POST", body: JSON.stringify(values) }); form.resetFields(); await load(); message.success(`已预留 ${result.number}，请登记到旧流程`); }
      finally { setBusy(false); }
    } })}>
      <Form.Item name="businessType" rules={[{ required: true }]}><Select placeholder="业务分类" style={{ width: 180 }} options={Object.entries(categories).map(([value, label]) => ({ value, label }))} /></Form.Item>
      <Form.Item name="reason" rules={[{ required: true }]}><Input placeholder="旧流程登记单号和预留原因" maxLength={200} style={{ width: 340 }} /></Form.Item>
      <Button type="primary" htmlType="submit" loading={busy}>确认前预览</Button>
    </Form>
    <Table rowKey="id" dataSource={rows} scroll={{ x: 800 }} columns={[{ title: "已预留编号", width: 220, render: (_, row) => row.metadata.number }, { title: "登记原因", render: (_, row) => row.metadata.reason }, { title: "服务器预留时间", width: 220, dataIndex: "createdAt", render: (value) => new Date(value).toLocaleString("zh-CN") }]} />
  </Card>;
}

export function PasswordPanel({ api, required, onChanged, onCancel }: { api: Api; required?: boolean; onChanged: () => void; onCancel?: () => void }) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  return <div className="erp-centered"><Card title={required ? "首次登录：请先修改密码" : "修改登录密码"} style={{ width: 440 }}>
    <Alert type="info" showIcon title="新密码至少12位，包含字母和数字。修改后所有会话失效，请重新登录。" />
    <Form layout="vertical" style={{ marginTop: 16 }} onFinish={async (values) => {
      setBusy(true);
      try { await api("/api/v1/auth/password", { method: "POST", body: JSON.stringify(values) }); message.success("密码已修改，请重新登录"); onChanged(); }
      catch (error) { message.error(error instanceof Error ? error.message : "修改失败"); } finally { setBusy(false); }
    }}>
      <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
      <Form.Item name="newPassword" label="新密码" rules={[{ required: true, min: 12 }]}><Input.Password autoComplete="new-password" /></Form.Item>
      <Form.Item name="confirmPassword" label="再次输入新密码" dependencies={["newPassword"]} rules={[{ required: true }, ({ getFieldValue }) => ({ validator: (_, value) => value === getFieldValue("newPassword") ? Promise.resolve() : Promise.reject(new Error("两次密码不一致")) })]}><Input.Password autoComplete="new-password" /></Form.Item>
      <Space><Button type="primary" htmlType="submit" loading={busy}>保存密码并重新登录</Button>{onCancel && <Button onClick={onCancel}>返回</Button>}</Space>
    </Form>
  </Card></div>;
}

export function AccountWorkspace({ api }: { api: Api }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<Account[]>([]);
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const [resetting, setResetting] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const [resetForm] = Form.useForm();
  const role = Form.useWatch("role", form);
  const level = Form.useWatch("level", form);
  const workshop = Form.useWatch("workshop", form);
  async function load() { setRows(await api<Account[]>("/api/v1/admin/employees")); }
  useEffect(() => { load().catch((error) => message.error(error.message)); }, [api]);
  function edit(value: Account | "new") { form.resetFields(); form.setFieldsValue(value === "new" ? { role: "SALES", level: "STAFF", active: true } : { ...value, processCodes: assignedProcessCodes(value) }); setEditing(value); }
  async function save() {
    const values = await form.validateFields(); setBusy(true);
    try {
      await api(editing === "new" ? "/api/v1/admin/employees" : `/api/v1/admin/employees/${(editing as Account).id}`, { method: "POST", body: JSON.stringify({ ...values, ...(editing && editing !== "new" ? { updatedAt: editing.updatedAt } : {}) }) });
      setEditing(null); await load(); message.success("员工资料已保存，受影响账号需重新登录");
    } catch (error) { message.error(error instanceof Error ? error.message : "保存失败"); } finally { setBusy(false); }
  }
  return <Card title="员工账号管理" className="erp-table-card" extra={<Button type="primary" onClick={() => edit("new")}>新增员工账号</Button>}>
    <Alert type="info" showIcon title="每人独立账号。角色变更、停用或密码重置会立即撤销旧会话；新账号首次登录须修改密码。" style={{ marginBottom: 16 }} />
    <Table rowKey="id" dataSource={rows} scroll={{ x: 1530 }} pagination={{ pageSize: 15 }} columns={[
      { title: "员工号", dataIndex: "employeeNo", width: 120 }, { title: "姓名", dataIndex: "name", width: 120 }, { title: "账号", dataIndex: "username", width: 160 }, { title: "部门", dataIndex: "department", width: 140 },
      { title: "岗位", dataIndex: "role", width: 150, render: (value: keyof typeof roles, row) => value === "SALES" ? salesRoleLabel(row) : roles[value] }, { title: "所属品牌", dataIndex: "businessUnit", width: 120, render: (value: string) => SALES_UNIT_LABELS[value] ?? "—" }, { title: "负责工序", width: 340, ellipsis: true, render: (_, row) => row.role !== "WORKSHOP" ? "—" : row.level === "SUPERVISOR" ? "本车间全部工序（主管）" : workshopProcessOptions(row.workshop).filter((option) => assignedProcessCodes(row).includes(option.value)).map((option) => option.label).join("、") },
      { title: "状态", dataIndex: "active", width: 90, render: (active: boolean) => <Tag color={active ? "green" : "default"}>{active ? "启用" : "停用"}</Tag> },
      { title: "操作", fixed: "right", width: 190, render: (_, row) => <Space><Button size="small" onClick={() => edit(row)}>编辑</Button><Button size="small" onClick={() => { resetForm.resetFields(); setResetting(row); }}>重置密码</Button></Space> },
    ]} />
    <Modal title={editing === "new" ? "新增员工账号" : "编辑员工权限"} open={!!editing} onCancel={() => setEditing(null)} onOk={save} confirmLoading={busy} okText="保存" destroyOnHidden>
      <Form layout="vertical" form={form}>
        {[ ["employeeNo", "员工编号"], ["username", "登录账号"], ["name", "姓名"], ["department", "部门"] ].map(([name, label]) => <Form.Item key={name} name={name} label={label} rules={[{ required: true }]}><Input maxLength={80} /></Form.Item>)}
        <Form.Item name="role" label="岗位" rules={[{ required: true }]}><Select options={Object.entries(roles).map(([value, label]) => ({ value, label }))} /></Form.Item>
        <Form.Item name="level" label="层级"><Select options={[{ value: "STAFF", label: "员工" }, { value: "SUPERVISOR", label: "主管" }]} /></Form.Item>
        {role === "SALES" && <Form.Item name="businessUnit" label="销售所属品牌" extra="主管查看本品牌全部订单；销售员只查看本人订单。" rules={[{ required: true }]}><Select options={Object.entries(SALES_UNIT_LABELS).map(([value, label]) => ({ value, label }))} /></Form.Item>}
        {role === "WORKSHOP" && <><Form.Item name="workshop" label="车间" rules={[{ required: true }]}><Select onChange={() => form.setFieldValue("processCodes", [])} options={Object.entries(WORKSHOP_LABELS).map(([value, label]) => ({ value, label }))} /></Form.Item>{level === "STAFF" && <Form.Item name="processCodes" label="负责工序（可多选）" rules={[{ required: true, type: "array", min: 1, message: "请至少分配一道本车间工序" }]} extra="同一人可负责多道指定工序；每道须分别报工，前序完成后才开放。"><Select mode="multiple" placeholder="选择该员工实际负责的工序" options={workshopProcessOptions(workshop)} /></Form.Item>}</>}
        {editing === "new" && <Form.Item name="password" label="临时密码（私下交给员工）" rules={[{ required: true, min: 12 }]}><Input.Password autoComplete="new-password" /></Form.Item>}
        <Form.Item name="active" label="启用账号" valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Modal>
    <Modal title={`重置密码 · ${resetting?.name ?? ""}`} open={!!resetting} onCancel={() => setResetting(null)} okText="重置并撤销旧会话" confirmLoading={busy} onOk={async () => {
      const values = await resetForm.validateFields(); setBusy(true);
      try { await api(`/api/v1/admin/employees/${resetting!.id}/reset-password`, { method: "POST", body: JSON.stringify(values) }); setResetting(null); message.success("临时密码已设置，员工首次登录须修改"); } catch (error) { message.error(error instanceof Error ? error.message : "重置失败"); } finally { setBusy(false); }
    }}><Form form={resetForm} layout="vertical"><Form.Item name="password" label="新临时密码" rules={[{ required: true, min: 12 }]}><Input.Password autoComplete="new-password" /></Form.Item></Form></Modal>
  </Card>;
}

export function MiniProgramAccounts({ api }: { api: Api }) {
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState<MiniAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [invite, setInvite] = useState<{ employeeName: string; inviteCode: string; expiresAt: string } | null>(null);
  async function load() {
    setLoading(true);
    try { setRows(await api<MiniAccount[]>("/api/v1/admin/mini-program/employees")); }
    finally { setLoading(false); }
  }
  useEffect(() => { load().catch((error) => message.error(error instanceof Error ? error.message : "加载失败")); }, [api]);
  async function createInvite(row: MiniAccount) {
    try {
      const result = await api<{ inviteCode: string; expiresAt: string }>(`/api/v1/admin/mini-program/employees/${row.id}/invite`, { method: "POST" });
      setInvite({ employeeName: row.name, ...result });
      await load();
    } catch (error) { message.error(error instanceof Error ? error.message : "邀请码生成失败"); }
  }
  function unbind(row: MiniAccount) {
    modal.confirm({
      title: `解除 ${row.name} 的微信绑定？`,
      content: "解除后，该员工所有小程序会话立即失效；需要重新生成邀请码才能再次绑定。",
      okText: "确认解除", okButtonProps: { danger: true }, cancelText: "取消",
      onOk: async () => { await api(`/api/v1/admin/mini-program/employees/${row.id}/unbind`, { method: "POST" }); await load(); message.success("微信绑定和移动会话已撤销"); },
    });
  }
  return <Card title="小程序员工绑定" className="erp-table-card">
    <Alert type="info" showIcon title="一个小程序按岗位进入各自工作台" description="邀请码24小时有效且只能使用一次。页面展示十类在用岗位；员工不能在小程序自行切换角色。小程序接口未启用时，绑定登录仍会拒绝访问。" style={{ marginBottom: 16 }} />
    <Table rowKey="id" loading={loading} dataSource={rows} pagination={{ pageSize: 15 }} scroll={{ x: 920 }} columns={[
      { title: "员工", width: 190, render: (_, row) => <div><strong>{row.name}</strong><small className="erp-subline">{row.employeeNo}</small></div> },
      { title: "岗位工作区", width: 190, render: (_, row) => row.role === "SALES" ? salesRoleLabel(row) : roles[row.role as keyof typeof roles] ?? row.role },
      { title: "部门", dataIndex: "department", width: 150 },
      { title: "账号状态", width: 100, render: (_, row) => <Tag color={row.active ? "success" : "default"}>{row.active ? "启用" : "停用"}</Tag> },
      { title: "微信绑定", width: 210, render: (_, row) => row.bindingStatus === "BOUND" ? <div><Tag color="success">已绑定</Tag><small className="erp-subline">{row.boundAt ? new Date(row.boundAt).toLocaleString("zh-CN") : ""}</small></div> : row.bindingStatus === "INVITED" ? <div><Tag color="processing">待绑定</Tag><small className="erp-subline">{row.inviteExpiresAt ? `${new Date(row.inviteExpiresAt).toLocaleString("zh-CN")} 失效` : ""}</small></div> : <Tag>未绑定</Tag> },
      { title: "操作", fixed: "right", width: 210, render: (_, row) => <Space>{row.bindingStatus === "BOUND" ? <Button danger size="small" onClick={() => unbind(row)}>解除绑定</Button> : <Button type="primary" size="small" disabled={!row.active} onClick={() => createInvite(row)}>{row.bindingStatus === "INVITED" ? "重新生成邀请码" : "生成邀请码"}</Button>}</Space> },
    ]} />
    <Modal title={`小程序一次性邀请码 · ${invite?.employeeName ?? ""}`} open={Boolean(invite)} footer={<Space><Button onClick={() => setInvite(null)}>关闭</Button><Button type="primary" onClick={async () => { if (!invite) return; await navigator.clipboard.writeText(invite.inviteCode); message.success("邀请码已复制"); }}>复制邀请码</Button></Space>} onCancel={() => setInvite(null)} destroyOnHidden>
      <Alert type="warning" showIcon title="邀请码仅在本窗口显示一次" description="请通过可信方式单独交给员工，不要发送到公共群聊。员工绑定成功后，该邀请码自动失效。" />
      <Input.TextArea value={invite?.inviteCode ?? ""} readOnly autoSize style={{ marginTop: 16, fontFamily: "monospace" }} />
      <p>有效期至：{invite ? new Date(invite.expiresAt).toLocaleString("zh-CN") : "—"}</p>
    </Modal>
  </Card>;
}

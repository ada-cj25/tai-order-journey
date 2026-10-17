import { Button, Tag, Tabs } from "antd";
import { LOCAL_SALES } from "../server/domain/local-sales-roster";
import { LOCAL_WORKERS } from "../server/domain/local-worker-roster";
import { workshopProcessOptions, WORKSHOP_LABELS, type Workshop } from "../server/domain/workshop-processes";

// Only loaded by Vite's development build, after the local API and hostname gates pass.
const GROUPS = [
  { label: "业务流程岗位", accounts: [
    ["chairman", "董事长管理员"], ["sales", "诺尔丽原销售郑佳"], ["designer", "设计师郑思雁"],
    ["designer2", "设计师林若溪（交接测试）"],
    ["orderadmin", "订单管理员（前置审单＋技术审单）"], ["technical", "技术拆单"],
    ["procurement", "采购"], ["finance", "财务"], ["installer", "安装"], ["aftersales", "售后"],
  ] },
  { label: "四车间主管", accounts: [
    ["workshop", "板式车间主管"], ["woodmanager", "木工车间主管"], ["paintmanager", "油漆车间主管"],
    ["assemblymanager", "组装车间主管"],
  ] },
  { label: "销售权限范围测试", accounts: [
    ["sales2", "诺尔丽原销售陈珊"], ["salesmanager", "诺尔丽销售主管"], ["aikejumgr", "艾可居销售主管"],
  ] },
] as const;

export default function LocalTestAccounts({ disabled, onChoose }: { disabled: boolean; onChoose: (values: { username: string; password: string }) => void }) {
  return <section className="erp-local-test-accounts" aria-label="本地测试账号">
    <div className="erp-local-test-heading"><strong>本地测试账号</strong><Tag color="cyan">仅限 localhost</Tag></div>
    <p>先选岗位，再点击右侧“登录”。切换的是实际账号，权限由服务器校验。</p>
    <Tabs className="erp-local-account-tabs" defaultActiveKey="sales" items={[
      { key: "sales", label: "品牌销售（4）", children: <div className="erp-local-test-group">
        <p>各品牌主管查看本品牌全部订单；销售员只查看自己的订单。每个测试销售员均有独立测试订单。</p>
        {([ ["NOERLI", "诺尔丽", "salesmanager"], ["AIKEJU", "艾可居", "aikejumgr"] ] as const).map(([unit, label, manager]) => <div className="erp-local-test-group" key={unit}>
          <h3>{label}销售团队</h3><div className="erp-local-test-grid">
            <Button disabled={disabled} onClick={() => onChoose({ username: manager, password: "erp123456" })}><strong>{label}销售主管</strong><small>{manager}</small></Button>
            {LOCAL_SALES.filter((sales) => sales.businessUnit === unit).map((sales) => <Button key={sales.username} disabled={disabled} onClick={() => onChoose({ username: sales.username, password: "erp123456" })}><strong>{sales.name}</strong><small>{sales.username}</small></Button>)}
          </div>
        </div>)}
      </div> },
      { key: "business", label: "业务岗位", children: <div className="erp-local-test-grid">{GROUPS[0].accounts.map(([username, label]) => <Button key={username} disabled={disabled} onClick={() => onChoose({ username, password: "erp123456" })}><strong>{label}</strong><small>{username}</small></Button>)}</div> },
      { key: "workers", label: "车间工人（12）", children: <div className="erp-local-test-group erp-local-workers">
      <h3>工序工人 · 12人独立账号（板式5 / 木工3 / 油漆3 / 组装1）</h3>
      <Tabs size="small" items={(Object.keys(WORKSHOP_LABELS) as Workshop[]).map((workshop) => ({
        key: workshop, label: WORKSHOP_LABELS[workshop],
        children: <div className="erp-local-test-grid erp-local-worker-grid">{LOCAL_WORKERS.filter((worker) => worker.workshop === workshop).map((worker) => <Button key={worker.username} disabled={disabled} onClick={() => onChoose({ username: worker.username, password: "erp123456" })}>
          <strong>{worker.name}</strong><small>{worker.username}</small>
          <span className="erp-local-worker-duties">{workshopProcessOptions(workshop).filter((option) => worker.processCodes.includes(option.value)).map((option) => option.label).join(" / ")}</span>
        </Button>)}</div>,
      }))} />
    </div> },
      { key: "supervisors", label: "主管与销售", children: GROUPS.slice(1).map((group) => <div className="erp-local-test-group" key={group.label}>
        <h3>{group.label}</h3><div className="erp-local-test-grid">{group.accounts.map(([username, label]) => <Button key={username} disabled={disabled} onClick={() => onChoose({ username, password: "erp123456" })}><strong>{label}</strong><small>{username}</small></Button>)}</div>
      </div>) },
    ]} />
    <p className="erp-local-test-note">默认测试密码：<code>erp123456</code>。如已修改，请在右侧填写新密码；此入口不会重置账号。</p>
  </section>;
}

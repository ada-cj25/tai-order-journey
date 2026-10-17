import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const procurement = await readFile(new URL("../src/ProcurementWorkspace.tsx", import.meta.url), "utf8");

test("成本角色收起重复物料表并保持成本明细舒展和单行状态", () => {
  assert.match(app, /\{!selectedCost && <Table/);
  assert.match(app, /erp-order-cost-panel/);
  assert.match(app, /erp-cost-detail-section/);
  assert.match(app, /erp-cost-price-pending/);
  assert.match(app, /scroll=\{\{ x: 980 \}\}/);
  assert.doesNotMatch(app, /展开追溯/);
  assert.match(styles, /\.erp-order-cost-panel > \.ant-card-body \{[^}]*gap:24px/);
  assert.match(styles, /\.erp-cost-price-pending \{[^}]*white-space:nowrap/);
});

test("五项成本摘要在内部横向滚动且金额不换行", () => {
  assert.match(app, /className="erp-cost-summary-scroll"[^>]*role="region"[^>]*tabIndex=\{0\}/);
  assert.equal((app.match(/className="erp-cost-summary-item"/g) ?? []).length, 5);
  assert.match(styles, /\.erp-cost-summary-scroll \{[^}]*overflow-x:auto/);
  assert.match(styles, /\.erp-cost-summary-track \{[^}]*min-width:1130px/);
  assert.match(styles, /\.erp-cost-summary-item strong \{[^}]*font-variant-numeric:tabular-nums[^}]*white-space:nowrap/);
});

test("售后成本在成本摘要和明细中均排最后", () => {
  const costCard = app.slice(app.indexOf('id="order-material-cost"'), app.indexOf('title="阶段资料与审核记录"'));
  const summary = costCard.slice(costCard.indexOf('className="erp-cost-summary-track"'), costCard.indexOf('className="erp-cost-detail-section"'));
  const details = costCard.slice(costCard.indexOf('className="erp-cost-detail-section"'));
  assert.ok(summary.indexOf("<span>外购成品成本</span>") < summary.indexOf("<span>售后成本</span>"));
  assert.ok(details.indexOf("物料单成本明细") < details.indexOf("售后成本明细"));
});

test("订单成本顶部突出总成本，未完成归集时标明暂计，外购成本单列", () => {
  assert.match(app, /className="erp-cost-total" role="status"/);
  assert.match(app, /当前订单总成本/);
  assert.match(app, /selectedCost\.grandTotal == null \? "（暂计）"/);
  assert.match(app, /外购成品成本明细/);
  assert.doesNotMatch(app, /成本尚未全部归集|外购成本未计入/);
  assert.doesNotMatch(app, /当前总成本＝物料单成本/);
  assert.match(styles, /\.erp-cost-total strong \{[^}]*font-size:clamp\(/);
});

test("四车间完成后及安装人员订单详情不显示区域物料发布汇总和详细物料表", () => {
  assert.match(app, /selected\.materialVersion && !selected\.production\?\.complete && employee\.role !== "INSTALLER" && <Card title=\{`区域物料发布汇总/);
});

test("车间综合单价卡直接展示表格，不保留重复的初始标准说明", () => {
  assert.doesNotMatch(procurement, /订单管理员完成技术审单时按当时有效版本快照|初始标准：板式/);
});

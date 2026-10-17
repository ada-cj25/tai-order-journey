import assert from "node:assert/strict";
import test from "node:test";
import { responsibilityTypeLabel, supplementTypeLabel } from "../../src/order-labels.js";

test("补单来源和责任方式在详情页统一显示中文", () => {
  assert.equal(supplementTypeLabel("INSTALLATION_ISSUE"), "安装现场问题");
  assert.equal(supplementTypeLabel("PRODUCTION_ISSUE"), "生产责任问题");
  assert.equal(supplementTypeLabel("DESIGN_ISSUE"), "设计责任问题");
  assert.equal(supplementTypeLabel("CUSTOMER_ADDITION"), "客户增项");
  assert.equal(supplementTypeLabel("AFTERSALES"), "售后补单");
  assert.equal(responsibilityTypeLabel("CUSTOMER_PAID"), "客户付费");
  assert.equal(responsibilityTypeLabel("COMPANY_RESPONSIBILITY"), "公司责任·免收");
  assert.equal(responsibilityTypeLabel("DESIGN_RESPONSIBILITY"), "设计责任·免收");
  assert.equal(responsibilityTypeLabel("PRODUCTION_RESPONSIBILITY"), "生产责任·免收");
  assert.equal(responsibilityTypeLabel("PENDING"), "待定责");
  assert.equal(supplementTypeLabel("LEGACY_UNKNOWN"), "其他补单来源");
  assert.equal(responsibilityTypeLabel("LEGACY_UNKNOWN"), "其他责任方式");
});

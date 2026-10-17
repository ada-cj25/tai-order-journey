import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/WorkflowActionModal.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("customer acceptance modal is compact with equal-sized business controls", () => {
  assert.match(source, /command === "ACCEPT_CUSTOMER"\s*\n\s*\? "erp-customer-acceptance-modal"/);
  assert.match(source, /command === "ACCEPT_CUSTOMER" \? 680/);
  assert.match(source, /name="acceptedAt"[^>]*className="erp-acceptance-field"/);
  assert.match(source, /name="customerConclusion"[^>]*className="erp-acceptance-field"/);
  assert.match(css, /\.erp-customer-acceptance-modal \.erp-form-grid\s*\{[^}]*min-height:\s*0/s);
  assert.match(css, /\.erp-customer-acceptance-modal \.erp-acceptance-field :is\(\.ant-picker,\s*textarea\)\s*\{[^}]*height:\s*40px/s);
  assert.match(css, /\.erp-customer-acceptance-modal \.erp-evidence-step\s*\{[^}]*min-height:\s*0/s);
  assert.match(css, /\.erp-customer-acceptance-modal \.erp-upload-box\s*\{[^}]*min-height:\s*64px/s);
});

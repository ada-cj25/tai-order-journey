import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("outsource arrival fields share aligned rows and control dimensions", () => {
  assert.match(app, /className="erp-outsource-arrival-fields"/);
  assert.match(app, /className="erp-outsource-arrival-row"/);
  assert.doesNotMatch(app, /addonAfter=\{line\.unit\}/);
  assert.match(css, /\.erp-outsource-arrival-row\s*\{[^}]*grid-template-columns:\s*120px\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.erp-outsource-arrival-control\s*\{[^}]*width:\s*100%/s);
});

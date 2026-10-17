import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { validateUploadForCategory } from "./upload-policy.js";

function workbook() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["设计图"]]), "图纸");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test("CAD设计图栏接受真实Excel并拒绝伪装Excel", () => {
  assert.equal(validateUploadForCategory("DESIGN_CAD", "设计图.xlsx", workbook()).extension, ".xlsx");
  assert.throws(() => validateUploadForCategory("DESIGN_CAD", "伪装图纸.xlsx", Buffer.from("not-an-excel")), /内容与扩展名不一致/);
});

test("Excel只允许进入CAD设计图栏，不进入客户确认图或样块栏", () => {
  const file = workbook();
  assert.throws(() => validateUploadForCategory("DESIGN_CONFIRMATION", "设计图.xlsx", file), /不能上传到当前资料栏/);
  assert.throws(() => validateUploadForCategory("CUSTOMER_SAMPLE_BLOCK", "设计图.xlsx", file), /不能上传到当前资料栏/);
});

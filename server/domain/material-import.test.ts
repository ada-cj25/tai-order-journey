import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { calculatePurchaseQuantity, parseMaterialWorkbook, validatePublishedMaterialLines } from "./material-import.js";

test("普通板材按0.85、金属板按0.9计算并保留4位小数", () => {
  assert.deepEqual(calculatePurchaseQuantity({ name: "柜身厚板", unit: "㎡", actualQty: 85 }), { purchaseQty: 100, lossRate: 0.85, source: "CALCULATED" });
  assert.deepEqual(calculatePurchaseQuantity({ name: "18mm金属板", unit: "㎡", actualQty: 90 }), { purchaseQty: 100, lossRate: 0.9, source: "CALCULATED" });
});

test("物料导入只读取物料单并忽略零数量行", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["不应导入", 99, "件"]]), "分解单");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["诺尔丽物料分解单"],
    ["诺尔丽五金配件单"],
    ["", "", "", "名称及型号", "", "数量", "", "", "", "", "", "单位"],
    ["", "", "", "大调整脚+扣子", "120", 10, "", "", "", "", "", "只"],
    ["", "", "", "保护膜", "", 5, "", "", "", "", "", "卷"],
    ["", "", "", "木榫", "", 20, "", "", "", "", "", "件"],
    ["", "", "", "空模板行", "", 0, "", "", "", "", "", "件"],
  ]), "物料单");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const result = parseMaterialWorkbook(buffer, "sample.xlsx", ["木榫"]);
  assert.equal(result.sheetName, "物料单");
  assert.equal(result.lines.length, 3);
  assert.equal(result.lines[0]?.purchaseQty, 10);
  assert.equal(result.lines[1]?.purchaseQty, 5);
  assert.equal(result.lines[2]?.inventoryMode, "STOCK_STANDARD");
  assert.equal(result.lines[2]?.readinessClass, "DELIVERY_READINESS");
});

test("五金复合行拆成子行，台湾川湖只读取数量且尺寸进入规格", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["诺尔丽物料分解单"],
    ["诺尔丽五金配件单"],
    ["", "", "", "名称及型号", "", "数量", "", "", "", "", "", "单位"],
    ["", "", "", "直弯铰链:", "BLUM+阻尼", "铰链：", 8, "", "阻尼：", 8, "", "只"],
    ["", "", "", "自攻螺丝：", "长 + 短", 120, "", "", 80, "", "", "只"],
    ["", "", "", "台湾川湖", 18, 4, "", "", "", "", "", "付"],
  ]), "物料单");
  const result = parseMaterialWorkbook(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), "hardware.xlsx", [], "HARDWARE_MATERIALS");
  assert.deepEqual(result.lines.map((line) => [line.normalizedName, line.purchaseQty, line.specification, line.sourceSubRow]), [
    ["直弯铰链", 8, "BLUM+阻尼", "A"],
    ["阻尼器", 8, "BLUM+阻尼", "B"],
    ["自攻螺丝（长）", 120, "长", "A"],
    ["自攻螺丝（短）", 80, "短", "B"],
    ["台湾川湖", 4, "18寸", "A"],
  ]);
});

test("五金物料单上半段同时解析面积、采购数量和普通数量区域", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["诺尔丽物料分解单"],
    ["", "", "仓库1", "名称及型号", "", "实际面积", "", "", "采购面积", "", "", "单位"],
    ["", "", "", "柜身厚板:", "18mm免漆多层板", 53.37, "", "", 62.79, "", "", "㎡"],
    ["", "", "", "金属板:", "18mm", 9, "", "", 10, "", "", "㎡"],
    ["", "", "", "名称及型号", "", "核算数量", "", "", "采购数量", "", "", "单位"],
    ["", "", "", "柜身封边带1.0*22", "", 550, "", "", 600, "", "", "米"],
    ["诺尔丽五金配件单"],
    ["", "", "", "名称及型号", "", "数量", "", "", "", "", "", "单位"],
    ["", "", "", "木榫", "", 40, "", "", "", "", "", "只"],
  ]), "物料单");
  const result = parseMaterialWorkbook(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), "hardware.xlsx", [], "HARDWARE_MATERIALS");
  assert.deepEqual(result.lines.map((line) => [line.normalizedName, line.actualQty, line.purchaseQty, line.unit]), [
    ["柜身厚板", 53.37, 62.79, "㎡"],
    ["金属板", 9, 10, "㎡"],
    ["柜身封边带1.0*22", 550, 600, "米"],
    ["木榫", 40, 40, "只"],
  ]);
});

test("下料单从原材料段开始，排除油漆耗用配方", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["分解"]]), "分解单");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["油漆生产下料单"],
    ["PU透明底", 12, "千克"],
    ["实木原材料生产下料单"],
    ["产品型号", "", "原材料名称", "实际面积(平方)"],
    ["", "", "18mm多层板", 17, "", "㎡"],
    ["实木原材料采购单"],
  ]), "下料单");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["计价"]]), "实木计价单");
  const result = parseMaterialWorkbook(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), "door.xlsx", []);
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0]?.rawName, "18mm多层板");
});

test("V3下料单忽略原材料段上方公式错误并提取生产编号", () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["实木油漆生产下料单"],
    ["客户：", "#REF!"],
    ["", "", "PU透明底", "#REF!", "", "", "千克"],
    ["实木原材料生产下料单"],
    ["客户：", "2607508-测试客户"],
    ["产品型号", "", "原材料名称", "实际面积(平方)", "", "耗材立方"],
    ["平板门材质：测试板", "", "1.0*22封边条", "130米"],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "下料单");
  const result = parseMaterialWorkbook(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), "veneer.xlsx", [], "VENEER_DOOR");
  assert.equal(result.valid, true);
  assert.equal(result.sourceProductionNumber, "2607508");
  assert.equal(result.lines[0]?.purchaseQty, 130);
});

test("V3解析器把负数和混合数量定位为阻断错误", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["实木原材料生产下料单"],
    ["客户：", "2606124-测试客户"],
    ["产品型号", "", "原材料名称", "实际面积(平方)"],
    ["", "", "多层板", -0.1],
    ["", "", "钢化玻璃", "4块 车间提供尺寸"],
  ]), "下料单");
  const result = parseMaterialWorkbook(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), "paint.xlsx", [], "PAINT_WOOD");
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((item) => [item.code, item.row, item.column]), [["NEGATIVE_QUANTITY", 4, undefined], ["MIXED_QUANTITY", 5, "D"]]);
});

test("无法识别单位或未人工核定的行不能发布", () => {
  assert.throws(() => validatePublishedMaterialLines([{ sourceRow: 5, rawName: "特殊件", normalizedName: "特殊件", unit: "未识别", actualQty: 1, purchaseQty: 1, needsManualReview: true, manualReason: null } as never]), /尚未完成核定/);
});

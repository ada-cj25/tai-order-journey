import * as XLSX from "xlsx";
import type { InventoryMode, MaterialTemplateType } from "./types.js";

export type MaterialReadiness = "PRODUCTION_REQUIRED" | "DELIVERY_READINESS";

export type ImportedMaterialLine = {
  sourceFileName: string; sourceSheet: string; sourceRow: number; sourceSubRow: string;
  templateType: MaterialTemplateType; parserVersion: string;
  rawName: string; rawSpecification: string | null; rawUnit: string | null;
  rawActualValue: string | null; rawPurchaseValue: string | null;
  normalizedName: string; specification: string | null; unit: string; category: string;
  actualQty: number; lossRate: number | null; purchaseQty: number;
  calculationSource: "CALCULATED" | "SOURCE_VALUE" | "MANUAL_REQUIRED";
  inventoryMode: InventoryMode; readinessClass: MaterialReadiness;
  needsManualReview: boolean; manualReason: string | null;
};

export type MaterialImportResult = {
  templateType: MaterialTemplateType; parserVersion: string; sheetName: "物料单" | "下料单";
  fingerprintVersion: string; sourceProductionNumber: string | null; valid: boolean;
  rawRows: unknown[][]; lines: ImportedMaterialLine[]; errors: MaterialImportIssue[];
};

export type MaterialImportIssue = {
  code: "MISSING_SHEET" | "FINGERPRINT_MISMATCH" | "MISSING_PRODUCTION_NUMBER" | "PRODUCTION_NUMBER_MISMATCH" | "FORMULA_ERROR" | "NEGATIVE_QUANTITY" | "MIXED_QUANTITY" | "UNKNOWN_UNIT";
  row: number;
  column?: string;
  message: string;
  rawValue?: string;
};

type ParsedNumber = { value: number; unit: string | null; index: number; raw: string };
const PARSER_VERSION = "V3.0";
const FINGERPRINT_VERSION = "FORMAL-XLS-20260831-V1";
const UNITS = ["平方米", "m²", "㎡", "千克", "kg", "KG", "米", "m", "M", "件", "只", "个", "块", "张", "套", "根", "支", "卷", "桶", "付", "本", "台", "盒"];
const SKIP_TEXT = /^(名称及型号|名称型号|实际面积|采购面积|核算数量|采购数量|数量|单位|记|发|仓库\d*|客户|编号|单|备注|型号)$/;
const SKIP_ROW = /(包装|计件工资|价格表|颜色见样|油漆生产下料单|PU透明底|固化剂|稀释剂|底擦色|底漆|面修色|面漆)/;
const MATERIAL_SECTION = /原材料生产下料单/;
const METAL = /(金属板|铝板|钢板|不锈钢板)/;
const BOARD = /(板|木皮|饰面|背板|柜身|门板)/;
const WOOD = /(木方|木条|木皮|木材|杉木|松木|木榫|封边)/;
const HARDWARE = /(五金|铰链|拉手|滑轨|抽屉|螺丝|螺钉|感应|开关|变压器|杜邦线|连接线|吊码|管座|调整脚|搁板销|木榫|偏心|防撞粒|角铁|下水管|保护膜|软胶|轮|门碰|锁|篮|反弹器|阻尼|扣子|川湖)/;
const PROFILE: Record<MaterialTemplateType, { sheet: "物料单" | "下料单"; anchors: RegExp[] }> = {
  HARDWARE_MATERIALS: { sheet: "物料单", anchors: [/诺尔丽物料分解单/, /名称及型号/, /诺尔丽五金配件单/] },
  PAINT_WOOD: { sheet: "下料单", anchors: [MATERIAL_SECTION, /产品型号/, /原材料名称/, /实际面积/] },
  SOLID_WOOD_DOOR: { sheet: "下料单", anchors: [MATERIAL_SECTION, /产品型号/, /原材料名称/, /实际面积/] },
  VENEER_DOOR: { sheet: "下料单", anchors: [MATERIAL_SECTION, /产品型号/, /原材料名称/, /平板门材质/] },
};

function textValue(value: unknown) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function round4(value: number) { return Math.round((value + Number.EPSILON) * 10_000) / 10_000; }
function parseNumber(value: unknown, index: number): ParsedNumber | null {
  if (typeof value === "number" && Number.isFinite(value)) return { value, unit: null, index, raw: String(value) };
  const text = textValue(value).replace(/,/g, "");
  const match = text.match(/^(-?\d+(?:\.\d+)?)\s*(平方米|m²|㎡|千克|kg|KG|米|m|M|件|只|个|块|张|套|根|支|卷|桶|付|本|台|盒)?$/);
  return match ? { value: Number(match[1]), unit: match[2] ?? null, index, raw: text } : null;
}
export function normalizeMaterialName(value: string) { return value.replace(/[：:]/g, "").replace(/[（）()\s]/g, "").trim().toLowerCase(); }
function normalizedUnit(value: string | null) {
  if (!value) return "未识别";
  if (["m²", "㎡", "平方米"].includes(value)) return "㎡";
  if (["m", "M", "米"].includes(value)) return "米";
  if (["kg", "KG", "千克"].includes(value)) return "千克";
  return value;
}
export function materialCategory(name: string) {
  if (METAL.test(name)) return "METAL_PANEL"; if (HARDWARE.test(name)) return "HARDWARE";
  if (/玻璃|镜/.test(name)) return "GLASS"; if (/石英石|石材|人造石/.test(name)) return "STONE";
  if (WOOD.test(name)) return "WOOD"; if (BOARD.test(name)) return "BOARD"; return "GENERAL";
}
export function calculatePurchaseQuantity(input: { name: string; unit: string; actualQty: number; sourcePurchaseQty?: number | null }) {
  const { name, unit, actualQty } = input;
  if (actualQty < 0) throw new RangeError("实际数量不能小于0");
  if (input.sourcePurchaseQty != null && input.sourcePurchaseQty > 0) return { purchaseQty: round4(input.sourcePurchaseQty), lossRate: null, source: "SOURCE_VALUE" as const };
  if (unit === "㎡" && METAL.test(name)) return { purchaseQty: round4(actualQty / 0.9), lossRate: 0.9, source: "CALCULATED" as const };
  if (unit === "㎡" && BOARD.test(name)) return { purchaseQty: round4(actualQty / 0.85), lossRate: 0.85, source: "CALCULATED" as const };
  return { purchaseQty: round4(actualQty), lossRate: null, source: "SOURCE_VALUE" as const };
}
function inferTemplate(workbook: XLSX.WorkBook): MaterialTemplateType { return workbook.SheetNames.includes("物料单") ? "HARDWARE_MATERIALS" : "PAINT_WOOD"; }
function verifyProfile(type: MaterialTemplateType, workbook: XLSX.WorkBook, rows: unknown[][]): MaterialImportIssue[] {
  const profile = PROFILE[type];
  const issues: MaterialImportIssue[] = [];
  if (!workbook.SheetNames.includes(profile.sheet)) {
    issues.push({ code: "MISSING_SHEET", row: 0, message: `所选类别必须包含“${profile.sheet}”工作表` });
    return issues;
  }
  const text = rows.flat().map(textValue).filter(Boolean).join(" ");
  for (const anchor of profile.anchors) if (!anchor.test(text)) issues.push({ code: "FINGERPRINT_MISMATCH", row: 0, message: `文件结构与所选类别不匹配：缺少结构标记 ${anchor.source}` });
  return issues;
}

function productionNumberFromText(value: string) {
  const supplement = value.match(/补单-B\d{7,10}/i)?.[0];
  if (supplement) return supplement;
  return value.match(/\d{7,10}/)?.[0] ?? null;
}

function extractProductionNumber(type: MaterialTemplateType, rows: unknown[][]) {
  if (type === "HARDWARE_MATERIALS") {
    for (let rowIndex = 0; rowIndex < Math.min(rows.length, 12); rowIndex += 1) {
      const cells = rows[rowIndex]!.map(textValue);
      const labelIndex = cells.findIndex((cell) => /生产编号/.test(cell));
      if (labelIndex < 0) continue;
      for (let index = labelIndex + 1; index < cells.length; index += 1) {
        const value = productionNumberFromText(cells[index]!);
        if (value) return value;
      }
    }
  } else {
    let inMaterialSection = false;
    for (const row of rows) {
      const cells = row.map(textValue);
      if (cells.some((cell) => MATERIAL_SECTION.test(cell))) inMaterialSection = true;
      if (!inMaterialSection || !cells.some((cell) => /^客户[：:]?$/.test(cell))) continue;
      for (const cell of cells) {
        const value = productionNumberFromText(cell);
        if (value) return value;
      }
    }
  }
  return null;
}

function columnName(index: number) { return XLSX.utils.encode_col(index); }
function looksLikeMixedQuantity(value: unknown) { return /^(?:-?\d|各\d)/.test(textValue(value)); }
function mixedQuantityIssue(row: number, column: number, rawValue: unknown, name: string): MaterialImportIssue {
  return { code: "MIXED_QUANTITY", row, column: columnName(column), rawValue: textValue(rawValue), message: `${name}数量包含尺寸、备注或其他混合文字，必须修正源Excel` };
}
function cleanLabel(value: string) { return value.replace(/[：:]\s*(?:0|#REF!|#NAME\?)?$/i, "").trim(); }
function findName(cells: string[], numbers: ParsedNumber[], unitIndex: number) {
  return cells.map((value, index) => ({ value, index })).find(({ value, index }) => value && index !== unitIndex && !numbers.some((number) => number.index === index) && !SKIP_TEXT.test(value) && !/^(仓库\d*|数量|单位)$/.test(value) && !/物料.*单|下料单|原材料生产下料单/.test(value));
}
type ParsedPart = { name: string; quantity: ParsedNumber; specification?: string | null };

function makeLine(input: { fileName: string; sheetName: "物料单" | "下料单"; row: number; subRow: number; type: MaterialTemplateType; rawName: string; part: ParsedPart; explicitUnit: string | null; sourcePurchase?: number | null; standardNames: Set<string> }): ImportedMaterialLine {
  const unit = normalizedUnit(input.part.quantity.unit ?? input.explicitUnit);
  const calculation = calculatePurchaseQuantity({ name: input.part.name, unit, actualQty: input.part.quantity.value, sourcePurchaseQty: input.sourcePurchase });
  const category = materialCategory(input.part.name);
  const needsManualReview = unit === "未识别";
  return {
    sourceFileName: input.fileName, sourceSheet: input.sheetName, sourceRow: input.row, sourceSubRow: String.fromCharCode(65 + input.subRow), templateType: input.type, parserVersion: PARSER_VERSION,
    rawName: input.rawName, rawSpecification: input.part.specification ?? null, rawUnit: input.part.quantity.unit ?? input.explicitUnit, rawActualValue: input.part.quantity.raw, rawPurchaseValue: input.sourcePurchase == null ? null : String(input.sourcePurchase),
    normalizedName: input.part.name, specification: input.part.specification ?? null, unit, category, actualQty: round4(input.part.quantity.value), lossRate: calculation.lossRate, purchaseQty: calculation.purchaseQty,
    calculationSource: calculation.source, inventoryMode: input.standardNames.has(normalizeMaterialName(input.part.name)) ? "STOCK_STANDARD" : "ORDER_SPECIFIC",
    readinessClass: category === "HARDWARE" || category === "GLASS" || category === "STONE" ? "DELIVERY_READINESS" : "PRODUCTION_REQUIRED", needsManualReview, manualReason: needsManualReview ? "未识别单位" : null,
  };
}

function numberAt(row: unknown[], index: number) { return parseNumber(row[index], index); }

function hardwareParts(rawName: string, cells: string[], row: unknown[]): ParsedPart[] {
  const part = (name: string, index: number, specification?: string | null): ParsedPart | null => {
    const quantity = numberAt(row, index);
    return quantity?.value && quantity.value > 0 ? { name, quantity, specification } : null;
  };
  if (/台湾川湖|三节.*轨|托底抽|豪华带阻尼抽屉/.test(rawName)) {
    const size = cells[4] && cells[4] !== "寸" ? (/^\d+$/.test(cells[4]) ? `${cells[4]}寸` : cells[4]) : null;
    return [part(rawName, 5, size)].filter((entry): entry is ParsedPart => entry !== null);
  }
  if (/自攻螺丝/.test(rawName)) return [part("自攻螺丝（长）", 5, "长"), part("自攻螺丝（短）", 8, "短")].filter((entry): entry is ParsedPart => entry !== null);
  if (/吊码的固定配件/.test(rawName)) return [part("吊码预埋件", 6), part("5×40螺丝", 9, "5×40")].filter((entry): entry is ParsedPart => entry !== null);
  if (/筒灯.*变压器/.test(rawName)) return [part("筒灯", 6), part("变压器", 9)].filter((entry): entry is ParsedPart => entry !== null);
  if (/铰链/.test(rawName) && (cells[5].includes("铰链") || cells[8].includes("阻尼") || cells[8].includes("反弹器"))) {
    const secondName = cells[8].includes("反弹器") ? "图特反弹器" : cells[8].includes("阻尼") ? "阻尼器" : "阻尼/反弹器";
    return [part(rawName, 6, cells[4] || null), part(secondName, 9, cells[4] || null)].filter((entry): entry is ParsedPart => entry !== null);
  }
  if (cells[7] && numberAt(row, 9)?.value) {
    return [part(rawName, 5, cells[4] || null), part(cleanLabel(cells[7]), 9)].filter((entry): entry is ParsedPart => entry !== null);
  }
  return [part(rawName, 5, cells[4] && !/^(数量|客户自备)$/.test(cells[4]) ? cells[4] : null)].filter((entry): entry is ParsedPart => entry !== null);
}

function parseHardwareRows(fileName: string, rows: unknown[][], standardNames: Set<string>) {
  const lines: ImportedMaterialLine[] = []; const errors: MaterialImportIssue[] = [];
  let inUpperSection = false; let inHardwareSection = false; let upperMode: "AREA" | "PURCHASE" | "QUANTITY" = "QUANTITY";
  rows.forEach((row, index) => {
    const cells = row.map(textValue); const joined = cells.filter(Boolean).join(" ");
    if (/诺尔丽五金配件单/.test(joined)) { inUpperSection = false; inHardwareSection = true; return; }
    if (/名称及型号/.test(joined)) {
      if (!inHardwareSection) {
        inUpperSection = true;
        upperMode = /实际面积/.test(joined) ? "AREA" : /采购数量/.test(joined) ? "PURCHASE" : "QUANTITY";
      }
      return;
    }
    if ((!inUpperSection && !inHardwareSection) || /客户：/.test(joined) || !cells[3] || SKIP_TEXT.test(cells[3])) return;
    if (/#REF!|#NAME\?/.test(joined)) { errors.push({ code: "FORMULA_ERROR", row: index + 1, message: "导入材料区包含错误公式，必须修正源Excel", rawValue: joined }); return; }
    const rawName = cleanLabel(cells[3]);
    if (inUpperSection) {
      const actual = numberAt(row, 5) ?? numberAt(row, 4);
      const purchase = upperMode === "AREA" || upperMode === "PURCHASE" ? numberAt(row, 8) : null;
      const rawCandidates = upperMode === "AREA" || upperMode === "PURCHASE" ? [5, 8] : [5];
      const mixedIndex = rawCandidates.find((cellIndex) => looksLikeMixedQuantity(row[cellIndex]) && !numberAt(row, cellIndex));
      if (mixedIndex != null) { errors.push(mixedQuantityIssue(index + 1, mixedIndex, row[mixedIndex], rawName)); return; }
      const meaningful = actual?.value && actual.value !== 0 ? actual : purchase?.value && purchase.value !== 0 ? purchase : null;
      if (!meaningful) return;
      if (meaningful.value < 0 || (purchase && purchase.value < 0)) { errors.push({ code: "NEGATIVE_QUANTITY", row: index + 1, message: `${rawName}数量为负数，必须修正源Excel`, rawValue: meaningful.raw }); return; }
      const explicitUnit = UNITS.includes(cells[11]) ? cells[11] : meaningful.unit;
      const specification = cells[4] && !parseNumber(cells[4], 4) && !/^(数量|客户自备)$/.test(cells[4]) ? cells[4] : null;
      const part: ParsedPart = { name: rawName, quantity: meaningful, specification };
      const line = makeLine({
        fileName, sheetName: "物料单", row: index + 1, subRow: 0, type: "HARDWARE_MATERIALS", rawName, part, explicitUnit,
        sourcePurchase: purchase?.value && purchase.value > 0 ? purchase.value : null, standardNames,
      });
      if (line.needsManualReview) errors.push({ code: "UNKNOWN_UNIT", row: index + 1, message: `${rawName}未识别单位，必须修正源Excel`, rawValue: meaningful.raw });
      lines.push(line);
      return;
    }
    const candidateIndexes = /铰链/.test(rawName) ? [6, 9] : /吊码的固定配件|筒灯.*变压器/.test(rawName) ? [6, 9] : /自攻螺丝/.test(rawName) ? [5, 8] : cells[7] ? [5, 9] : [5];
    const mixedIndex = candidateIndexes.find((cellIndex) => looksLikeMixedQuantity(row[cellIndex]) && !numberAt(row, cellIndex));
    if (mixedIndex != null) { errors.push(mixedQuantityIssue(index + 1, mixedIndex, row[mixedIndex], rawName)); return; }
    const candidates = candidateIndexes.map((cellIndex) => numberAt(row, cellIndex)).filter((entry): entry is ParsedNumber => Boolean(entry));
    if (candidates.some((entry) => entry.value < 0)) { errors.push({ code: "NEGATIVE_QUANTITY", row: index + 1, message: "数量为负数，必须修正源Excel", rawValue: candidates.find((entry) => entry.value < 0)?.raw }); return; }
    const parts = hardwareParts(rawName, cells, row); if (!parts.length) return;
    const explicitUnit = UNITS.includes(cells[11]) ? cells[11] : null;
    parts.forEach((part, partIndex) => {
      const line = makeLine({ fileName, sheetName: "物料单", row: index + 1, subRow: partIndex, type: "HARDWARE_MATERIALS", rawName, part, explicitUnit, standardNames });
      if (line.needsManualReview) errors.push({ code: "UNKNOWN_UNIT", row: index + 1, message: `${part.name}未识别单位，必须修正源Excel`, rawValue: part.quantity.raw });
      lines.push(line);
    });
  });
  return { lines, errors };
}

function parseDownRows(fileName: string, type: Exclude<MaterialTemplateType, "HARDWARE_MATERIALS">, rows: unknown[][], standardNames: Set<string>) {
  const lines: ImportedMaterialLine[] = []; const errors: MaterialImportIssue[] = [];
  let inSection = false; let defaultUnit: string | null = null; let hasPurchaseColumn = false;
  rows.forEach((row, index) => {
    const cells = row.map(textValue); const joined = cells.filter(Boolean).join(" ");
    if (MATERIAL_SECTION.test(joined)) { inSection = true; defaultUnit = null; hasPurchaseColumn = false; return; }
    if (!inSection || !joined || SKIP_ROW.test(joined)) return;
    if (/原材料采购单/.test(joined)) { defaultUnit = null; hasPurchaseColumn = false; return; }
    if (/产品型号/.test(joined) && /原材料名称/.test(joined)) {
      defaultUnit = /实际面积/.test(joined) ? "㎡" : null;
      hasPurchaseColumn = /采购面积/.test(joined);
      return;
    }
    if (/#REF!|#NAME\?/.test(joined)) { errors.push({ code: "FORMULA_ERROR", row: index + 1, message: "原材料区包含错误公式，必须修正源Excel", rawValue: joined }); return; }
    const rawName = cleanLabel(cells[2] || ""); if (!rawName || /^(原材料名称|0)$/.test(rawName)) return;
    const actual = numberAt(row, 3); const sourcePurchase = hasPurchaseColumn ? numberAt(row, 5) : null;
    if (looksLikeMixedQuantity(row[3]) && !actual) { errors.push(mixedQuantityIssue(index + 1, 3, row[3], rawName)); return; }
    if (hasPurchaseColumn && looksLikeMixedQuantity(row[5]) && !sourcePurchase) { errors.push(mixedQuantityIssue(index + 1, 5, row[5], rawName)); return; }
    const selected = actual?.value && actual.value !== 0 ? actual : sourcePurchase?.value && sourcePurchase.value > 0 ? sourcePurchase : null;
    if (!selected) return;
    if (selected.value < 0 || (sourcePurchase && sourcePurchase.value < 0)) { errors.push({ code: "NEGATIVE_QUANTITY", row: index + 1, message: `${rawName}数量为负数，必须修正源Excel`, rawValue: selected.raw }); return; }
    const explicitUnit = selected.unit ?? (UNITS.includes(cells[5]) ? cells[5] : defaultUnit);
    const specTexts = [cells[0], cells[1], hasPurchaseColumn ? "" : cells[5], cells[7]].filter((value) => value && !/^(产品型号|材料|辅料|五金|其他)$/.test(value));
    const part: ParsedPart = { name: rawName, quantity: selected, specification: specTexts.join(" · ") || null };
    const line = makeLine({ fileName, sheetName: "下料单", row: index + 1, subRow: 0, type, rawName, part, explicitUnit, sourcePurchase: sourcePurchase?.value && sourcePurchase.value > 0 ? sourcePurchase.value : null, standardNames });
    if (line.needsManualReview) errors.push({ code: "UNKNOWN_UNIT", row: index + 1, message: `${rawName}未识别单位，必须修正源Excel`, rawValue: selected.raw });
    lines.push(line);
  });
  return { lines, errors };
}

function parseRows(fileName: string, type: MaterialTemplateType, sheetName: "物料单" | "下料单", rows: unknown[][], standardNames: Set<string>) {
  return type === "HARDWARE_MATERIALS"
    ? parseHardwareRows(fileName, rows, standardNames)
    : parseDownRows(fileName, type, rows, standardNames);
}
export function parseMaterialWorkbook(buffer: Buffer, fileName: string, standardMaterialNames: string[], requestedType?: MaterialTemplateType): MaterialImportResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellFormula: true, cellNF: false, cellText: true });
  const templateType = requestedType ?? inferTemplate(workbook); const sheetName = PROFILE[templateType].sheet; const sheet = workbook.Sheets[sheetName];
  if (!sheet) return {
    templateType, parserVersion: PARSER_VERSION, fingerprintVersion: FINGERPRINT_VERSION, sourceProductionNumber: null, valid: false, sheetName, rawRows: [], lines: [],
    errors: [{ code: "MISSING_SHEET", row: 0, message: `所选类别必须包含“${sheetName}”工作表` }],
  };
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "", blankrows: true });
  const errors = verifyProfile(templateType, workbook, rawRows);
  const sourceProductionNumber = extractProductionNumber(templateType, rawRows);
  if (!sourceProductionNumber) errors.push({ code: "MISSING_PRODUCTION_NUMBER", row: 0, message: "未能从正式表头提取生产编号" });
  const parsed = errors.some((issue) => issue.code === "MISSING_SHEET" || issue.code === "FINGERPRINT_MISMATCH")
    ? { lines: [] as ImportedMaterialLine[], errors: [] as MaterialImportIssue[] }
    : parseRows(fileName, templateType, sheetName, rawRows, new Set(standardMaterialNames.map(normalizeMaterialName)));
  errors.push(...parsed.errors);
  if (!parsed.lines.length && !errors.length) errors.push({ code: "FINGERPRINT_MISMATCH", row: 0, message: "目标材料区没有可预览的非零物料行" });
  return { templateType, parserVersion: PARSER_VERSION, fingerprintVersion: FINGERPRINT_VERSION, sourceProductionNumber, valid: errors.length === 0 && parsed.lines.length > 0, sheetName, rawRows, lines: parsed.lines, errors };
}
export function validatePublishedMaterialLines(lines: ImportedMaterialLine[]) {
  if (!lines.length) throw new Error("物料单没有可发布的非零物料行");
  const invalid = lines.find((line) => !line.normalizedName.trim() || line.unit === "未识别" || line.actualQty < 0 || line.purchaseQty <= 0 || line.purchaseQty < line.actualQty || (line.needsManualReview && !line.manualReason?.trim()));
  if (invalid) throw new Error(`第${invalid.sourceRow}-${invalid.sourceSubRow}行物料尚未完成核定：${invalid.rawName}`);
}

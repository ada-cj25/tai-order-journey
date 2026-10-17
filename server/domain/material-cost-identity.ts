export type MaterialCostIdentity = {
  normalizedName: string;
  specification: string | null;
  specificationKey: string;
  unit: string;
};

const RAIL_SIZE_BY_INCH: Record<string, string> = {
  "10": "250",
  "12": "300",
  "14": "350",
  "16": "400",
  "18": "450",
  "20": "500",
};

const RAIL_INCH_BY_SIZE: Record<string, string> = Object.fromEntries(
  Object.entries(RAIL_SIZE_BY_INCH).map(([inch, millimetres]) => [millimetres, inch]),
);

export function normalizedSpecificationKey(value: string | null | undefined) {
  return String(value ?? "").replace(/[（）()\s]/g, "").trim().toLowerCase();
}

export function normalizedCostUnit(value: string) {
  const unit = value.trim();
  if (["m²", "平方米"].includes(unit)) return "㎡";
  if (["m", "M"].includes(unit)) return "米";
  if (["kg", "KG"].includes(unit)) return "千克";
  return unit;
}

export function railSizeMillimetres(name: string, specification?: string | null) {
  const source = `${name} ${specification ?? ""}`.replace(/ｍｍ/gi, "mm");
  const millimetreMatch = source.match(/(?:^|\D)(250|300|350|400|450|500)\s*(?:mm|毫米)?(?:\D|$)/i);
  if (millimetreMatch) return millimetreMatch[1];
  const inchMatch = source.match(/(?:^|\D)(10|12|14|16|18|20)\s*寸(?:\D|$)/);
  return inchMatch ? RAIL_SIZE_BY_INCH[inchMatch[1]] : null;
}

export function materialCostIdentity(name: string, specification: string | null | undefined, unit: string): MaterialCostIdentity {
  const cleanName = name.trim();
  if (cleanName.includes("铰链")) {
    return { normalizedName: "铰链", specification: null, specificationKey: "", unit: "支" };
  }

  if (cleanName.includes("三节") && cleanName.includes("阻尼") && cleanName.includes("轨")) {
    const size = railSizeMillimetres(cleanName, specification);
    if (size) {
      const inch = RAIL_INCH_BY_SIZE[size];
      return { normalizedName: "三节阻尼轨", specification: `${size}mm / ${inch}寸`, specificationKey: `${size}mm`, unit: "套" };
    }
  }

  return {
    normalizedName: cleanName,
    specification: specification ?? null,
    specificationKey: normalizedSpecificationKey(specification),
    unit: normalizedCostUnit(unit),
  };
}

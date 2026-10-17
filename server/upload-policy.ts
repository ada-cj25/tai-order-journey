import { BadRequestException } from "@nestjs/common";
import { extname } from "node:path";

export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
const mimeTypes: Record<string, string> = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".heic": "image/heic", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xls": "application/vnd.ms-excel", ".csv": "text/csv", ".dwg": "application/acad", ".dxf": "application/dxf" };
const categoryExtensions: Record<string, ReadonlySet<string>> = {
  DESIGN_CAD: new Set([".dwg", ".dxf", ".pdf", ".xls", ".xlsx"]),
  DESIGN_CONFIRMATION: new Set([".pdf", ".png", ".jpg", ".jpeg"]),
  CUSTOMER_SAMPLE_BLOCK: new Set([".pdf", ".png", ".jpg", ".jpeg", ".heic"]),
  AFTERSALES_COST: new Set([".pdf", ".png", ".jpg", ".jpeg", ".heic"]),
};

export function validateUpload(name: string, buffer: Buffer) {
  const extension = extname(name).toLowerCase();
  const mimeType = mimeTypes[extension];
  if (!mimeType || buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) throw new BadRequestException("仅支持业务所需的PDF、图片、Excel、CSV、CAD文件，单个文件须为1字节至40MB");
  const head = buffer.subarray(0, 32);
  const text = head.toString("ascii");
  const matches = extension === ".pdf" ? text.startsWith("%PDF-")
    : extension === ".png" ? head.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
    : [".jpg", ".jpeg"].includes(extension) ? head.subarray(0, 3).toString("hex") === "ffd8ff"
    : extension === ".heic" ? text.slice(4, 8) === "ftyp"
    : extension === ".xlsx" ? head.subarray(0, 4).toString("hex") === "504b0304"
    : extension === ".xls" ? head.subarray(0, 8).toString("hex") === "d0cf11e0a1b11ae1"
    : extension === ".dwg" ? /^AC10\d{2}/.test(text)
    : extension === ".dxf" ? /SECTION|AutoCAD Binary DXF/i.test(buffer.subarray(0, 512).toString("ascii"))
    : !buffer.includes(0) && !/^\s*<(?:!doctype|html|script|svg)/i.test(buffer.subarray(0, 512).toString("utf8"));
  if (!matches) throw new BadRequestException("文件内容与扩展名不一致，请上传原始文件");
  return { extension, mimeType };
}

export function validateUploadForCategory(category: string, name: string, buffer: Buffer) {
  const validated = validateUpload(name, buffer);
  const allowed = categoryExtensions[category];
  if (allowed && !allowed.has(validated.extension)) throw new BadRequestException("该文件类型不能上传到当前资料栏，请选择符合栏位要求的原始文件");
  return validated;
}

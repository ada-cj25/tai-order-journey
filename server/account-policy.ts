import { BadRequestException } from "@nestjs/common";
import { salesBusinessTypes } from "./domain/sales-policy.js";
import { workshopProcessOptions } from "./domain/workshop-processes.js";

export function validatePassword(password: unknown): asserts password is string {
  if (typeof password !== "string" || password.length < 12 || Buffer.byteLength(password) > 72 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw new BadRequestException("密码至少12位，包含字母和数字，且不超过72字节");
}

export const ACTIVE_ROLES = ["CHAIRMAN", "ORDER_ADMIN", "FINANCE", "SALES", "DESIGNER", "TECHNICAL", "PROCUREMENT", "WORKSHOP", "INSTALLER", "AFTERSALES"];

export function validateAccount(input: Record<string, unknown>) {
  const text = (key: string) => typeof input[key] === "string" ? (input[key] as string).trim() : "";
  const role = text("role");
  const level = text("level") || "STAFF";
  if (!["STAFF", "SUPERVISOR"].includes(level) || !ACTIVE_ROLES.includes(role)) throw new BadRequestException("员工角色或层级无效；仓库账号已停用");
  for (const key of ["employeeNo", "username", "name", "department"]) if (!text(key) || text(key).length > 80) throw new BadRequestException(`${key}必填，且不超过80字`);
  if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(text("username"))) throw new BadRequestException("账号使用3–64位字母、数字、点、下划线或短横线");
  if (role === "SALES" && !salesBusinessTypes(text("businessUnit")).length) throw new BadRequestException("销售必须选择有效的所属品牌/业务单元");
  const workshop = role === "WORKSHOP" ? text("workshop") : null;
  let processCodes: string[] = [];
  if (role === "WORKSHOP") {
    const options = workshopProcessOptions(workshop);
    if (!options.length) throw new BadRequestException("请选择有效车间");
    if (level === "STAFF") {
      const codes = input.processCodes === undefined ? (text("processCode") ? [text("processCode")] : []) : input.processCodes;
      if (!Array.isArray(codes) || !codes.length || codes.length > options.length || codes.some((code) => typeof code !== "string" || !options.some((option) => option.value === code)) || new Set(codes).size !== codes.length) {
        throw new BadRequestException("工序工人必须分配本车间一道或多道准确工序，不能重复或跨车间分配");
      }
      processCodes = [...codes].sort();
    }
  }
  const processCode = processCodes[0] ?? null;
  if (input.active !== undefined && typeof input.active !== "boolean") throw new BadRequestException("账号启用状态无效");
  return { employeeNo: text("employeeNo"), username: text("username"), name: text("name"), department: text("department"), role, level, businessUnit: role === "SALES" ? text("businessUnit") : null, workshop, processCode, processCodes, active: input.active !== false };
}

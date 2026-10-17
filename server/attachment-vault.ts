import { BadRequestException, Controller, ForbiddenException, Get, Inject, Injectable, NotFoundException, Param, Post, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { currentEmployee } from "./auth.js";
import { normalizeUploadFilename } from "./domain/filenames.js";
import { PrismaService } from "./prisma.service.js";
import { AttachmentStorage } from "./attachment-storage.js";
import { validateUploadForCategory, MAX_UPLOAD_BYTES } from "./upload-policy.js";
import { requireAttachment, requireOrder, canUploadAttachment } from "./order-access.js";

@Injectable()
export class AttachmentVault {
  private readonly storage = new AttachmentStorage();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async save(orderId: string, employeeId: string, category: string, file?: { originalname: string; mimetype: string; size: number; buffer: Buffer }, productionAreaId?: string) {
    if (!file) throw new BadRequestException("请选择文件");
    const employee = await this.prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    if (!employee.active || employee.role === "WAREHOUSE") throw new BadRequestException("账号不可用");
    if (["HARDWARE_MATERIALS", "PAINT_WOOD", "SOLID_WOOD_DOOR", "VENEER_DOOR"].includes(category) && !["TECHNICAL", "CHAIRMAN"].includes(employee.role)) throw new ForbiddenException("只有技术拆单员可以上传物料Excel");
    const order = await requireOrder(this.prisma, orderId, employee);
    if (["DESIGN_CAD", "DESIGN_CONFIRMATION", "CUSTOMER_SAMPLE_BLOCK"].includes(category)
      && employee.role !== "CHAIRMAN"
      && (employee.role !== "DESIGNER" || order.designerId !== employee.id)) {
      throw new ForbiddenException("设计资料只能由当前设计师上传");
    }
    if (productionAreaId) {
      const area = await this.prisma.productionArea.findFirst({ where: { id: productionAreaId, orderId, cancelledAt: null }, select: { id: true } });
      if (!area) throw new BadRequestException("生产区域不存在或不属于当前订单");
    }
    if (!canUploadAttachment(employee, category, order)) throw new ForbiddenException("付款凭证只能由该订单的付款责任人上传；当前账号无权上传该附件类别");
    const originalName = normalizeUploadFilename(file.originalname);
    const { extension, mimeType } = validateUploadForCategory(category, originalName, file.buffer);
    const storageProvider = process.env.ATTACHMENT_STORAGE ?? "local";
    const storageKey = `${randomUUID()}${extension}`;
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    await this.storage.put(storageProvider, storageKey, file.buffer, mimeType);
    return this.prisma.attachment.create({
      data: { orderId, productionAreaId: productionAreaId || null, uploadedBy: employeeId, category, originalName, storageKey, storageProvider, sha256, mimeType, size: file.buffer.length },
    });
  }

  async open(id: string) {
    const { attachment, buffer } = await this.read(id);
    return { attachment, stream: Readable.from(buffer) };
  }

  async read(id: string) {
    const attachment = await this.prisma.attachment.findUnique({ where: { id } });
    if (!attachment) throw new NotFoundException("附件不存在");
    const buffer = await this.storage.read(attachment.storageProvider, attachment.storageKey);
    if (attachment.sha256 && createHash("sha256").update(buffer).digest("hex") !== attachment.sha256) throw new BadRequestException("附件完整性校验失败，请联系管理员恢复原文件");
    return { attachment: { ...attachment, originalName: normalizeUploadFilename(attachment.originalName) }, buffer };
  }
}

@Controller("api/v1/attachments")
export class AttachmentsController {
  constructor(@Inject(AttachmentVault) private readonly vault: AttachmentVault, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Post(":orderId")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async upload(
    @Param("orderId") orderId: string,
    @Req() request: Request,
    @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    const employee = await currentEmployee(this.prisma, request);
    return this.vault.save(orderId, employee.id, String(request.body.category ?? "OTHER"), file, typeof request.body.productionAreaId === "string" ? request.body.productionAreaId : undefined);
  }

  @Get(":id")
  async download(@Param("id") id: string, @Req() request: Request, @Res() response: Response) {
    await requireAttachment(this.prisma, id, await currentEmployee(this.prisma, request));
    const { attachment, stream } = await this.vault.open(id);
    response.type(attachment.mimeType);
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`);
    response.setHeader("Cache-Control", "private, no-store");
    await pipeline(stream, response);
  }
}

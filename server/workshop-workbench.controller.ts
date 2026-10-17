import { Controller, ForbiddenException, Get, Inject, Param, Req } from "@nestjs/common";
import type { Request } from "express";
import { currentEmployee } from "./auth.js";
import { projectWorkshopWorkbench } from "./domain/workshop-workbench.js";
import { orderScope } from "./order-access.js";
import { PrismaService } from "./prisma.service.js";

@Controller("api/v1/workshop")
export class WorkshopWorkbenchController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("workbench")
  async workbench(@Req() request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    this.assertWorkshopStaff(employee);
    return projectWorkshopWorkbench(employee, await this.loadOrders(employee));
  }

  @Get("production-areas/:productionNumber/assignment")
  async resolveProductionArea(@Param("productionNumber") productionNumber: string, @Req() request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    this.assertWorkshopStaff(employee);
    const area = await this.prisma.productionArea.findFirst({
      where: { productionNumber, order: orderScope(employee) },
      select: { id: true, cancelledAt: true },
    });
    if (!area) return { status: "INVALID", tasks: [], message: "二维码无效或生产区域不存在" };
    if (area.cancelledAt) return { status: "CANCELLED", tasks: [], message: "该生产区域已取消，不能继续报工" };

    const workbench = projectWorkshopWorkbench(employee, await this.loadOrders(employee, productionNumber));
    const tasks = workbench.allUnfinished.filter((task) => task.productionAreaId === area.id);
    if (!tasks.length) return { status: "UNASSIGNED", tasks: [], message: "该区域没有分配给当前账号的未完成工序" };
    const actionable = tasks.filter((task) => task.canReport);
    if (actionable.length === 1) return { status: "DIRECT", task: actionable[0], tasks: actionable, message: "已找到可报工工序" };
    if (actionable.length > 1) return { status: "MULTIPLE", tasks: actionable, message: "请选择要报工的具体工序" };
    return { status: "WAITING", tasks, message: tasks[0]?.waitingReason ?? "当前工序尚未解锁" };
  }

  private assertWorkshopStaff(employee: { role: string; level: string; workshop?: string | null }) {
    if (employee.role !== "WORKSHOP" || employee.level !== "STAFF" || !employee.workshop) {
      throw new ForbiddenException("车间工作台仅供已分配具体工序的一线员工使用");
    }
  }

  private loadOrders(employee: Awaited<ReturnType<typeof currentEmployee>>, productionNumber?: string) {
    return this.prisma.order.findMany({
      where: {
        stage: { in: ["PRODUCTION", "DELIVERY", "INSTALLATION"] },
        ...(productionNumber ? { productionAreas: { some: { productionNumber } } } : {}),
        ...orderScope(employee),
      },
      select: {
        id: true,
        trackingSerial: true,
        salesNumber: true,
        productionNumber: true,
        customerName: true,
        stage: true,
        rush: true,
        internalDueAt: true,
        updatedAt: true,
        productionProcesses: {
          include: {
            productionArea: { select: { id: true, name: true, productionNumber: true, cancelledAt: true } },
            productionRoute: { select: { id: true, kind: true, releasedAt: true } },
          },
          orderBy: [{ productionAreaId: "asc" }, { workshop: "asc" }, { sequence: "asc" }],
        },
        tasks: {
          where: { stage: "PRODUCTION", workshop: employee.workshop, status: { in: ["PENDING", "OVERDUE"] } },
          orderBy: { dueAt: "asc" },
          select: { dueAt: true, plannedStartAt: true, workloadDays: true },
          take: 1,
        },
      },
    });
  }
}

import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "./auth.js";
import { PrismaService } from "./prisma.service.js";
import { ReminderPlanner } from "./reminder.service.js";
import { localTestAccountsEnabled } from "./runtime-config.js";
import { miniProgramDevLoginEnabled, miniProgramEnabled } from "./mini-auth.service.js";

@Controller("api/health")
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(ReminderPlanner) private readonly reminders: ReminderPlanner) {}

  @Public()
  @Get("live")
  live() { return { status: "ok" }; }

  @Public()
  @Get("ready")
  async ready() {
    try {
      // Check the schema as well as database connectivity. No business data is returned.
      await this.prisma.employee.count({ where: { mustChangePassword: true } });
      if (!this.reminders.healthy()) throw new Error("Reminder scan stale");
      return { status: "ready" };
    } catch { throw new ServiceUnavailableException("服务尚未就绪"); }
  }
}

@Controller("api/v1/public")
export class PublicConfigController {
  @Public()
  @Get("config")
  config() {
    return {
      productName: "苔的跟单旅程",
      environment: process.env.APP_ENVIRONMENT === "company-test" ? "company-test" : process.env.NODE_ENV ?? "development",
      localTestAccountsEnabled: localTestAccountsEnabled(),
      miniProgramEnabled: miniProgramEnabled(),
      miniProgramDevLoginEnabled: miniProgramDevLoginEnabled(),
      icpFilingNumber: process.env.ICP_FILING_NUMBER?.trim() || null,
      publicSecurityFilingNumber: process.env.PUBLIC_SECURITY_FILING_NUMBER?.trim() || null,
      publicSecurityFilingUrl: process.env.PUBLIC_SECURITY_FILING_URL?.trim() || null,
    };
  }
}

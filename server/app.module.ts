import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { AttachmentVault, AttachmentsController } from "./attachment-vault.js";
import { AuthController, SessionGuard } from "./auth.js";
import { MaterialPackageService } from "./material-package.service.js";
import { MaterialCostController } from "./material-cost.controller.js";
import { MaterialCostService } from "./material-cost.service.js";
import { OrderNumberAllocator } from "./number-allocator.service.js";
import { AfterSalesController, HaixunController, InventoryController, NotificationsController, TasksController } from "./operations.controller.js";
import { OrdersController } from "./orders.controller.js";
import { OrdersService } from "./orders.service.js";
import {
  MaterialImportsController,
  MaterialVersionsController,
  ProcurementFlowController,
  ReplenishmentSuggestionsController,
  StockPolicyChangesController,
  TechnicalReviewsController,
  WarehouseMaterialReleasesController,
} from "./procurement.controller.js";
import { ProcurementFlow } from "./procurement-flow.service.js";
import { ProductionController } from "./production.controller.js";
import { ProductionService } from "./production.service.js";
import { ProductionAreaController } from "./production-area.controller.js";
import { ProductionAreaService } from "./production-area.service.js";
import { PrismaService } from "./prisma.service.js";
import { ReminderPlanner } from "./reminder.service.js";
import { TaskScheduler } from "./scheduler.service.js";
import { AccountsController } from "./accounts.controller.js";
import { HealthController, PublicConfigController } from "./health.controller.js";
import { NumberReservationsController } from "./number-reservations.controller.js";
import { PaymentAccountController } from "./payment-account.controller.js";
import { PaymentAccountService } from "./payment-account.service.js";
import { OutsourceFulfillmentController } from "./outsource-fulfillment.controller.js";
import { OutsourceFulfillmentService } from "./outsource-fulfillment.service.js";
import { PackageCountController } from "./package-count.controller.js";
import { PackageCountService } from "./package-count.service.js";
import { AfterSalesService } from "./aftersales.service.js";
import { WorkshopWorkbenchController } from "./workshop-workbench.controller.js";
import { MiniAuthController } from "./mini-auth.controller.js";
import { MiniAuthService } from "./mini-auth.service.js";
import { MiniWorkspaceController } from "./mini-workspace.controller.js";
import { MiniWorkspaceService } from "./mini-workspace.service.js";
import { MiniAttachmentsController, MiniPackageCountController, MiniProductionController, MiniWorkshopController } from "./mini-workshop.controller.js";
import { LoginWeatherController } from "./login-weather.controller.js";
import { LoginWeatherService } from "./login-weather.service.js";

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [
    AuthController,
    HealthController,
    PublicConfigController,
    LoginWeatherController,
    AccountsController,
    NumberReservationsController,
    OrdersController,
    TasksController,
    NotificationsController,
    InventoryController,
    ProcurementFlowController,
    MaterialImportsController,
    TechnicalReviewsController,
    WarehouseMaterialReleasesController,
    MaterialVersionsController,
    StockPolicyChangesController,
    ReplenishmentSuggestionsController,
    AfterSalesController,
    HaixunController,
    AttachmentsController,
    ProductionController,
    ProductionAreaController,
    MaterialCostController,
    PaymentAccountController,
    OutsourceFulfillmentController,
    PackageCountController,
    WorkshopWorkbenchController,
    MiniAuthController,
    MiniWorkspaceController,
    MiniWorkshopController,
    MiniProductionController,
    MiniPackageCountController,
    MiniAttachmentsController,
  ],
  providers: [
    PrismaService,
    OrderNumberAllocator,
    TaskScheduler,
    OrdersService,
    ReminderPlanner,
    AttachmentVault,
    MaterialPackageService,
    ProcurementFlow,
    ProductionService,
    ProductionAreaService,
    MaterialCostService,
    PaymentAccountService,
    OutsourceFulfillmentService,
    PackageCountService,
    AfterSalesService,
    MiniAuthService,
    MiniWorkspaceService,
    LoginWeatherService,
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
})
export class AppModule {}

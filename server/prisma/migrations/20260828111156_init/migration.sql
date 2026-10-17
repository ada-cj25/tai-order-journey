-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CHAIRMAN', 'ORDER_ADMIN', 'FINANCE', 'SALES', 'DESIGNER', 'TECHNICAL', 'PROCUREMENT', 'WORKSHOP', 'INSTALLER', 'AFTERSALES');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('NOERLI_FORMAL', 'NOERLI_SUPPLEMENT', 'AIKEJU_FORMAL', 'AIKEJU_SUPPLEMENT', 'CHANNEL_FORMAL', 'CHANNEL_SUPPLEMENT', 'ENGINEERING_FORMAL', 'ENGINEERING_SUPPLEMENT', 'WORKWEAR_FORMAL', 'WORKWEAR_SUPPLEMENT');

-- CreateEnum
CREATE TYPE "SiteType" AS ENUM ('FINISHED', 'ROUGH');

-- CreateEnum
CREATE TYPE "WorkflowStage" AS ENUM ('DEPOSIT_PENDING', 'DESIGN_PENDING', 'DESIGN_ACCEPTED', 'PRE_REVIEW', 'TECHNICAL', 'TECH_REVIEW', 'MATERIALS', 'PRODUCTION', 'INSTALLATION_APPLICATION', 'DELIVERY', 'INSTALLATION', 'ACCEPTANCE', 'BUSINESS_COMPLETE');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'COMPLETE', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InventoryMode" AS ENUM ('ORDER_SPECIFIC', 'STOCK_STANDARD');

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "employeeNo" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "trackingSerial" TEXT NOT NULL,
    "productionNumber" TEXT,
    "legacyOrderNumber" TEXT,
    "businessType" "BusinessType" NOT NULL,
    "siteType" "SiteType" NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "standardDueAt" TIMESTAMP(3) NOT NULL,
    "promisedAt" TIMESTAMP(3) NOT NULL,
    "internalDueAt" TIMESTAMP(3) NOT NULL,
    "rush" BOOLEAN NOT NULL DEFAULT false,
    "rushReason" TEXT,
    "rushPromisedAt" TIMESTAMP(3),
    "sundayRisk" BOOLEAN NOT NULL DEFAULT false,
    "stage" "WorkflowStage" NOT NULL DEFAULT 'DEPOSIT_PENDING',
    "currentOwnerLabel" TEXT NOT NULL,
    "nextAction" TEXT NOT NULL,
    "riskCount" INTEGER NOT NULL DEFAULT 0,
    "depositConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "tailPaymentConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "installationApplied" BOOLEAN NOT NULL DEFAULT false,
    "productionReady" BOOLEAN NOT NULL DEFAULT false,
    "hardwareReady" BOOLEAN NOT NULL DEFAULT false,
    "outsourceReady" BOOLEAN NOT NULL DEFAULT false,
    "finalAcceptedAt" TIMESTAMP(3),
    "parentOrderId" TEXT,
    "salesId" TEXT NOT NULL,
    "designerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionNumberSequence" (
    "id" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "category" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionNumberSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "ownerId" TEXT,
    "department" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "reminderAt" TIMESTAMP(3) NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "uniqueKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "fromStage" "WorkflowStage",
    "toStage" "WorkflowStage",
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "uniqueKey" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "mode" "InventoryMode" NOT NULL,
    "onHand" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "minimumStock" DECIMAL(12,3),
    "targetStock" DECIMAL(12,3),
    "replenishmentLot" DECIMAL(12,3),
    "approvedStandard" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseDemand" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "itemId" TEXT NOT NULL,
    "mode" "InventoryMode" NOT NULL,
    "requestedQty" DECIMAL(12,3) NOT NULL,
    "stockQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "purchaseQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL,
    "allocation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseDemand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "orderId" TEXT,
    "internalUse" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL,
    "direction" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AfterSalesCase" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "issueType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "warrantyYears" INTEGER,
    "warrantyStartsAt" TIMESTAMP(3),
    "warrantyExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AfterSalesCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HaixunImport" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "fileName" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "preview" JSONB NOT NULL,
    "errors" JSONB,
    "reviewedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HaixunImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeNo_key" ON "Employee"("employeeNo");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_username_key" ON "Employee"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Order_trackingSerial_key" ON "Order"("trackingSerial");

-- CreateIndex
CREATE UNIQUE INDEX "Order_productionNumber_key" ON "Order"("productionNumber");

-- CreateIndex
CREATE INDEX "Order_stage_internalDueAt_idx" ON "Order"("stage", "internalDueAt");

-- CreateIndex
CREATE INDEX "Order_salesId_createdAt_idx" ON "Order"("salesId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_designerId_stage_idx" ON "Order"("designerId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionNumberSequence_yearMonth_category_key" ON "ProductionNumberSequence"("yearMonth", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Task_uniqueKey_key" ON "Task"("uniqueKey");

-- CreateIndex
CREATE INDEX "Task_status_reminderAt_dueAt_idx" ON "Task"("status", "reminderAt", "dueAt");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_uniqueKey_key" ON "Notification"("uniqueKey");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_sku_key" ON "InventoryItem"("sku");

-- CreateIndex
CREATE INDEX "PurchaseDemand_orderId_status_idx" ON "PurchaseDemand"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AfterSalesCase_caseNumber_key" ON "AfterSalesCase"("caseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "HaixunImport_orderId_version_key" ON "HaixunImport"("orderId", "version");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_parentOrderId_fkey" FOREIGN KEY ("parentOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_salesId_fkey" FOREIGN KEY ("salesId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_designerId_fkey" FOREIGN KEY ("designerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDemand" ADD CONSTRAINT "PurchaseDemand_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDemand" ADD CONSTRAINT "PurchaseDemand_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AfterSalesCase" ADD CONSTRAINT "AfterSalesCase_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HaixunImport" ADD CONSTRAINT "HaixunImport_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

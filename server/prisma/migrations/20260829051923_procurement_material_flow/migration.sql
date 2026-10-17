-- CreateEnum
CREATE TYPE "TechnicalPackageStatus" AS ENUM ('PREVIEW', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MaterialVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'WAREHOUSE_RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MaterialReadinessClass" AS ENUM ('PRODUCTION_REQUIRED', 'DELIVERY_READINESS');

-- CreateEnum
CREATE TYPE "MaterialLineStatus" AS ENUM ('PENDING_REVIEW', 'WAITING_STOCK_CHECK', 'STOCK_RESERVED', 'PURCHASE_REQUIRED', 'PARTIAL_RECEIVED', 'READY', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseRequirementStatus" AS ENUM ('DRAFT', 'STOCK_RESERVED', 'PURCHASE_REQUIRED', 'REPLENISHMENT_SUGGESTED', 'QUOTING', 'PRICE_REVIEW', 'APPROVED', 'ORDERED', 'PARTIAL_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierQuoteStatus" AS ENUM ('DRAFT', 'PRICE_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'PRICE_REVIEW', 'APPROVED', 'ISSUED', 'PARTIAL_RECEIVED', 'RECEIVED', 'CLOSED', 'RETURN_IN_PROGRESS', 'PARTIALLY_CANCELLED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('DRAFT', 'ACCEPTED', 'PARTIAL_REJECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "StockPolicyChangeStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'TECH_REVIEWER';
ALTER TYPE "Role" ADD VALUE 'WAREHOUSE';

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "specification" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "materialSubstatus" TEXT NOT NULL DEFAULT '待技术物料版';

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "batchNo" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "materialLineId" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "referenceId" TEXT,
ADD COLUMN     "referenceType" TEXT;

-- CreateTable
CREATE TABLE "TechnicalPackageVersion" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "designVersion" TEXT NOT NULL,
    "status" "TechnicalPackageStatus" NOT NULL DEFAULT 'SUBMITTED',
    "haixunAttachmentId" TEXT NOT NULL,
    "decompositionAttachmentId" TEXT NOT NULL,
    "materialAttachmentId" TEXT NOT NULL,
    "validationSummary" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewComment" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicalPackageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialImportBatch" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "technicalPackageId" TEXT,
    "sourceAttachmentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "status" "MaterialVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "rawRows" JSONB NOT NULL,
    "normalizedRows" JSONB NOT NULL,
    "errors" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialListVersion" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "technicalPackageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "MaterialVersionStatus" NOT NULL DEFAULT 'PUBLISHED',
    "releasedBy" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "warehouseCheckedBy" TEXT,
    "warehouseCheckedAt" TIMESTAMP(3),
    "productionReleasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialListVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialLine" (
    "id" TEXT NOT NULL,
    "materialVersionId" TEXT NOT NULL,
    "itemId" TEXT,
    "sourceFileName" TEXT NOT NULL,
    "sourceSheet" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "rawName" TEXT NOT NULL,
    "rawSpecification" TEXT,
    "rawUnit" TEXT,
    "rawActualValue" TEXT,
    "rawPurchaseValue" TEXT,
    "normalizedName" TEXT NOT NULL,
    "specification" TEXT,
    "unit" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "actualQty" DECIMAL(16,4) NOT NULL,
    "lossRate" DECIMAL(8,4),
    "purchaseQty" DECIMAL(16,4) NOT NULL,
    "calculationSource" TEXT NOT NULL,
    "inventoryMode" "InventoryMode" NOT NULL,
    "readinessClass" "MaterialReadinessClass" NOT NULL,
    "needsManualReview" BOOLEAN NOT NULL DEFAULT false,
    "manualReason" TEXT,
    "correctedBy" TEXT,
    "correctedAt" TIMESTAMP(3),
    "stockQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "receivedQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "status" "MaterialLineStatus" NOT NULL DEFAULT 'WAITING_STOCK_CHECK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "materialLineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(16,4) NOT NULL,
    "status" "StockReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "location" TEXT,
    "batchNo" TEXT,
    "reservedBy" TEXT NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockPolicyVersion" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "StockPolicyChangeStatus" NOT NULL DEFAULT 'PROPOSED',
    "minimumStock" DECIMAL(16,4),
    "targetStock" DECIMAL(16,4),
    "replenishmentLot" DECIMAL(16,4),
    "proposedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "reason" TEXT NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "StockPolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequirement" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "materialVersionId" TEXT,
    "materialLineId" TEXT,
    "itemId" TEXT NOT NULL,
    "mode" "InventoryMode" NOT NULL,
    "requestedQty" DECIMAL(16,4) NOT NULL,
    "stockQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "purchaseQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "orderedQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "receivedQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "status" "PurchaseRequirementStatus" NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL,
    "requiredAt" TIMESTAMP(3),
    "riskLevel" TEXT NOT NULL DEFAULT 'NORMAL',
    "allocation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "phone" TEXT,
    "taxNo" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierQuote" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "SupplierQuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "unitPrice" DECIMAL(16,4) NOT NULL,
    "taxRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "freight" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "minimumOrderQty" DECIMAL(16,4),
    "deliveryAt" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "attachmentIds" JSONB,
    "note" TEXT,
    "submittedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewComment" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'APPROVED',
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "totalAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "expectedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "issuedBy" TEXT,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "specification" TEXT,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(16,4) NOT NULL,
    "unitPrice" DECIMAL(16,4) NOT NULL,
    "taxRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "receivedQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "cancelledQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseAllocation" (
    "id" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "orderId" TEXT,
    "materialVersionId" TEXT,
    "quantity" DECIMAL(16,4) NOT NULL,
    "receivedQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'ACCEPTED',
    "supplierDeliveryNo" TEXT,
    "deliveryAttachmentIds" JSONB,
    "receivedBy" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "deliveredQty" DECIMAL(16,4) NOT NULL,
    "acceptedQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "rejectedQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "shortageQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "photoAttachmentIds" JSONB,
    "qualityAttachmentIds" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReturn" (
    "id" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT NOT NULL,
    "receiptLineId" TEXT,
    "quantity" DECIMAL(16,4) NOT NULL,
    "resolution" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PurchaseReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialVersionCancellation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "materialVersionId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "supplierResolution" JSONB,
    "receivedResolution" JSONB,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "requestedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialVersionCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TechnicalPackageVersion_status_submittedAt_idx" ON "TechnicalPackageVersion"("status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicalPackageVersion_orderId_version_key" ON "TechnicalPackageVersion"("orderId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialImportBatch_technicalPackageId_key" ON "MaterialImportBatch"("technicalPackageId");

-- CreateIndex
CREATE INDEX "MaterialImportBatch_orderId_createdAt_idx" ON "MaterialImportBatch"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialListVersion_technicalPackageId_key" ON "MaterialListVersion"("technicalPackageId");

-- CreateIndex
CREATE INDEX "MaterialListVersion_orderId_status_idx" ON "MaterialListVersion"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialListVersion_orderId_version_key" ON "MaterialListVersion"("orderId", "version");

-- CreateIndex
CREATE INDEX "MaterialLine_materialVersionId_status_idx" ON "MaterialLine"("materialVersionId", "status");

-- CreateIndex
CREATE INDEX "MaterialLine_itemId_idx" ON "MaterialLine"("itemId");

-- CreateIndex
CREATE INDEX "StockReservation_orderId_status_idx" ON "StockReservation"("orderId", "status");

-- CreateIndex
CREATE INDEX "StockReservation_itemId_status_idx" ON "StockReservation"("itemId", "status");

-- CreateIndex
CREATE INDEX "StockPolicyVersion_status_proposedAt_idx" ON "StockPolicyVersion"("status", "proposedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockPolicyVersion_itemId_version_key" ON "StockPolicyVersion"("itemId", "version");

-- CreateIndex
CREATE INDEX "PurchaseRequirement_orderId_status_idx" ON "PurchaseRequirement"("orderId", "status");

-- CreateIndex
CREATE INDEX "PurchaseRequirement_status_requiredAt_idx" ON "PurchaseRequirement"("status", "requiredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE INDEX "SupplierQuote_status_submittedAt_idx" ON "SupplierQuote"("status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_orderNo_key" ON "PurchaseOrder"("orderNo");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_expectedAt_idx" ON "PurchaseOrder"("status", "expectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_quoteId_key" ON "PurchaseOrderLine"("quoteId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_purchaseOrderId_idx" ON "PurchaseOrderLine"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseAllocation_orderId_idx" ON "PurchaseAllocation"("orderId");

-- CreateIndex
CREATE INDEX "PurchaseAllocation_requirementId_idx" ON "PurchaseAllocation"("requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_receiptNo_key" ON "GoodsReceipt"("receiptNo");

-- CreateIndex
CREATE INDEX "GoodsReceipt_purchaseOrderId_receivedAt_idx" ON "GoodsReceipt"("purchaseOrderId", "receivedAt");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_purchaseOrderLineId_idx" ON "GoodsReceiptLine"("purchaseOrderLineId");

-- CreateIndex
CREATE INDEX "MaterialVersionCancellation_orderId_createdAt_idx" ON "MaterialVersionCancellation"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryItem_name_specification_idx" ON "InventoryItem"("name", "specification");

-- AddForeignKey
ALTER TABLE "TechnicalPackageVersion" ADD CONSTRAINT "TechnicalPackageVersion_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialImportBatch" ADD CONSTRAINT "MaterialImportBatch_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialImportBatch" ADD CONSTRAINT "MaterialImportBatch_technicalPackageId_fkey" FOREIGN KEY ("technicalPackageId") REFERENCES "TechnicalPackageVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialListVersion" ADD CONSTRAINT "MaterialListVersion_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialListVersion" ADD CONSTRAINT "MaterialListVersion_technicalPackageId_fkey" FOREIGN KEY ("technicalPackageId") REFERENCES "TechnicalPackageVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialLine" ADD CONSTRAINT "MaterialLine_materialVersionId_fkey" FOREIGN KEY ("materialVersionId") REFERENCES "MaterialListVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialLine" ADD CONSTRAINT "MaterialLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_materialLineId_fkey" FOREIGN KEY ("materialLineId") REFERENCES "MaterialLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPolicyVersion" ADD CONSTRAINT "StockPolicyVersion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequirement" ADD CONSTRAINT "PurchaseRequirement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequirement" ADD CONSTRAINT "PurchaseRequirement_materialVersionId_fkey" FOREIGN KEY ("materialVersionId") REFERENCES "MaterialListVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequirement" ADD CONSTRAINT "PurchaseRequirement_materialLineId_fkey" FOREIGN KEY ("materialLineId") REFERENCES "MaterialLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequirement" ADD CONSTRAINT "PurchaseRequirement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuote" ADD CONSTRAINT "SupplierQuote_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "PurchaseRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuote" ADD CONSTRAINT "SupplierQuote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "SupplierQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseAllocation" ADD CONSTRAINT "PurchaseAllocation_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseAllocation" ADD CONSTRAINT "PurchaseAllocation_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "PurchaseRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseAllocation" ADD CONSTRAINT "PurchaseAllocation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseAllocation" ADD CONSTRAINT "PurchaseAllocation_materialVersionId_fkey" FOREIGN KEY ("materialVersionId") REFERENCES "MaterialListVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "GoodsReceiptLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialVersionCancellation" ADD CONSTRAINT "MaterialVersionCancellation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialVersionCancellation" ADD CONSTRAINT "MaterialVersionCancellation_materialVersionId_fkey" FOREIGN KEY ("materialVersionId") REFERENCES "MaterialListVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

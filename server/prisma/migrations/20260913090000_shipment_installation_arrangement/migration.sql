ALTER TABLE "Shipment"
ADD COLUMN "installationDepartment" TEXT,
ADD COLUMN "siteContact" TEXT,
ADD COLUMN "plannedInstallationAt" TIMESTAMP(3),
ADD COLUMN "siteConditions" TEXT;

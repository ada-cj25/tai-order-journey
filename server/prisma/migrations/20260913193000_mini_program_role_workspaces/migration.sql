CREATE TYPE "AfterSalesStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

ALTER TABLE "AfterSalesCase"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "AfterSalesStatus" USING "status"::"AfterSalesStatus",
  ALTER COLUMN "status" SET DEFAULT 'OPEN',
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "resolution" TEXT;

ALTER TABLE "Shipment"
  ADD COLUMN "assignedInstallerId" TEXT,
  ADD COLUMN "installationTeamLabel" TEXT;

CREATE TABLE "MiniProgramInvite" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MiniProgramInvite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MiniProgramBinding" (
  "id" TEXT NOT NULL,
  "appId" TEXT NOT NULL,
  "openIdHash" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "inviteId" TEXT,
  "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "MiniProgramBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MiniProgramSession" (
  "id" TEXT NOT NULL,
  "bindingId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "accessTokenHash" TEXT NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "sessionVersion" INTEGER NOT NULL,
  "accessExpiresAt" TIMESTAMP(3) NOT NULL,
  "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MiniProgramSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MiniProgramDraft" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "draftKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MiniProgramDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MiniProgramInvite_tokenHash_key" ON "MiniProgramInvite"("tokenHash");
CREATE INDEX "MiniProgramInvite_employeeId_expiresAt_idx" ON "MiniProgramInvite"("employeeId", "expiresAt");
CREATE UNIQUE INDEX "MiniProgramBinding_appId_openIdHash_key" ON "MiniProgramBinding"("appId", "openIdHash");
CREATE UNIQUE INDEX "MiniProgramBinding_appId_employeeId_key" ON "MiniProgramBinding"("appId", "employeeId");
CREATE INDEX "MiniProgramBinding_employeeId_revokedAt_idx" ON "MiniProgramBinding"("employeeId", "revokedAt");
CREATE UNIQUE INDEX "MiniProgramSession_accessTokenHash_key" ON "MiniProgramSession"("accessTokenHash");
CREATE UNIQUE INDEX "MiniProgramSession_refreshTokenHash_key" ON "MiniProgramSession"("refreshTokenHash");
CREATE INDEX "MiniProgramSession_employeeId_revokedAt_refreshExpiresAt_idx" ON "MiniProgramSession"("employeeId", "revokedAt", "refreshExpiresAt");
CREATE UNIQUE INDEX "MiniProgramDraft_employeeId_kind_draftKey_key" ON "MiniProgramDraft"("employeeId", "kind", "draftKey");
CREATE INDEX "MiniProgramDraft_employeeId_updatedAt_idx" ON "MiniProgramDraft"("employeeId", "updatedAt");
CREATE INDEX "Shipment_assignedInstallerId_installedAt_idx" ON "Shipment"("assignedInstallerId", "installedAt");

ALTER TABLE "MiniProgramInvite" ADD CONSTRAINT "MiniProgramInvite_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MiniProgramInvite" ADD CONSTRAINT "MiniProgramInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MiniProgramBinding" ADD CONSTRAINT "MiniProgramBinding_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MiniProgramSession" ADD CONSTRAINT "MiniProgramSession_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "MiniProgramBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MiniProgramSession" ADD CONSTRAINT "MiniProgramSession_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MiniProgramDraft" ADD CONSTRAINT "MiniProgramDraft_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_assignedInstallerId_fkey" FOREIGN KEY ("assignedInstallerId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

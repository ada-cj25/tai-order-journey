ALTER TABLE "Employee" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Employee" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Attachment" ADD COLUMN "storageProvider" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "Attachment" ADD COLUMN "sha256" TEXT;
CREATE TABLE "SecurityAudit" (
  "id" TEXT NOT NULL PRIMARY KEY, "actorId" TEXT, "targetId" TEXT,
  "action" TEXT NOT NULL, "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SecurityAudit_createdAt_idx" ON "SecurityAudit"("createdAt");
CREATE TABLE "LoginAttempt" ("key" TEXT NOT NULL PRIMARY KEY, "attempts" INTEGER NOT NULL DEFAULT 1, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "MutationReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY, "actorId" TEXT NOT NULL, "scope" TEXT NOT NULL,
  "key" TEXT NOT NULL, "fingerprint" TEXT NOT NULL, "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "MutationReceipt_actorId_scope_key_key" ON "MutationReceipt"("actorId", "scope", "key");

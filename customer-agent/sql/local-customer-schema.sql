CREATE TABLE "CustomerAccount" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerAccount_phone_key" ON "CustomerAccount"("phone");

CREATE TABLE "CustomerOtp" (
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CustomerOtp_pkey" PRIMARY KEY ("phone")
);

CREATE TABLE "CustomerOrderGrant" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "reason" TEXT NOT NULL,
    CONSTRAINT "CustomerOrderGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerOrderGrant_customerId_orderId_key" ON "CustomerOrderGrant"("customerId", "orderId");
CREATE INDEX "CustomerOrderGrant_orderId_revokedAt_idx" ON "CustomerOrderGrant"("orderId", "revokedAt");
ALTER TABLE "CustomerOrderGrant" ADD CONSTRAINT "CustomerOrderGrant_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerOrderGrant" ADD CONSTRAINT "CustomerOrderGrant_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerOrderGrant" ADD CONSTRAINT "CustomerOrderGrant_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CustomerSupportRequest" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "question" TEXT NOT NULL,
    "verifiedSummary" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "CustomerSupportRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerSupportRequest_customerId_idempotencyKey_key" ON "CustomerSupportRequest"("customerId", "idempotencyKey");
CREATE INDEX "CustomerSupportRequest_status_createdAt_idx" ON "CustomerSupportRequest"("status", "createdAt");
ALTER TABLE "CustomerSupportRequest" ADD CONSTRAINT "CustomerSupportRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerSupportRequest" ADD CONSTRAINT "CustomerSupportRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CustomerSupportReply" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerSupportReply_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomerSupportReply_requestId_createdAt_idx" ON "CustomerSupportReply"("requestId", "createdAt");
ALTER TABLE "CustomerSupportReply" ADD CONSTRAINT "CustomerSupportReply_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CustomerSupportRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerSupportReply" ADD CONSTRAINT "CustomerSupportReply_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

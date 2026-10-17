ALTER TABLE "Order"
  ADD COLUMN "prepaymentRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "prepaymentReported" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "prepaymentConfirmed" BOOLEAN NOT NULL DEFAULT false;

-- Existing orders retain their historical single-deposit contract semantics.
-- Only newly created formal orders opt into the deposit + prepayment gate.

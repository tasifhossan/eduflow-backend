-- 1. Create Enums
CREATE TYPE "FeeBilling" AS ENUM ('MONTHLY', 'ONE_TIME', 'NONE');
CREATE TYPE "FeeChargeKind" AS ENUM ('TUITION', 'ADMISSION', 'EXAM', 'MATERIAL', 'OTHER');
CREATE TYPE "FeeChargeSource" AS ENUM ('GENERATED', 'MANUAL', 'INSTALLMENT', 'MIGRATED');
CREATE TYPE "FeeChargeStatus" AS ENUM ('ACTIVE', 'VOID');
CREATE TYPE "FeeAdjustmentType" AS ENUM ('DISCOUNT', 'WAIVER', 'CORRECTION');
CREATE TYPE "FeeAdjustmentStatus" AS ENUM ('ACTIVE', 'VOID');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BKASH', 'NAGAD', 'ROCKET', 'BANK', 'CARD', 'OTHER');
CREATE TYPE "PaymentSource" AS ENUM ('MANUAL', 'MIGRATED');

-- 2. Alter Existing Columns to Exact Decimal(12,2)
ALTER TABLE "Batch" 
  ALTER COLUMN "feeAmount" TYPE DECIMAL(12,2) USING ROUND("feeAmount"::numeric, 2);

ALTER TABLE "Enrollment" 
  ALTER COLUMN "customFeeAmount" TYPE DECIMAL(12,2) USING ROUND("customFeeAmount"::numeric, 2),
  ALTER COLUMN "discountValue" TYPE DECIMAL(12,2) USING ROUND("discountValue"::numeric, 2);

-- 3. Add Batch.feeBilling & CenterSettings.feeDueDay
ALTER TABLE "Batch" 
  ADD COLUMN "feeBilling" "FeeBilling" NOT NULL DEFAULT 'MONTHLY';

UPDATE "Batch" 
  SET "feeBilling" = CASE WHEN "feeAmount" > 0 THEN 'MONTHLY'::"FeeBilling" ELSE 'NONE'::"FeeBilling" END;

ALTER TABLE "CenterSettings" 
  ADD COLUMN "feeDueDay" INTEGER NOT NULL DEFAULT 10;

ALTER TABLE "CenterSettings" 
  ADD CONSTRAINT "CenterSettings_feeDueDay_check" CHECK ("feeDueDay" >= 1 AND "feeDueDay" <= 28);

-- 4. Create FeeCharge Table
CREATE TABLE "FeeCharge" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "enrollmentId" TEXT,
  "kind" "FeeChargeKind" NOT NULL,
  "period" TEXT,
  "description" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "dueDate" DATE NOT NULL,
  "source" "FeeChargeSource" NOT NULL,
  "status" "FeeChargeStatus" NOT NULL DEFAULT 'ACTIVE',
  "voidReason" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidedById" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FeeCharge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeeCharge_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "FeeCharge_enrollment_tuition_period_idx" 
  ON "FeeCharge" ("enrollmentId", "kind", "period") 
  WHERE "kind" = 'TUITION' AND "status" = 'ACTIVE' AND "period" IS NOT NULL;

CREATE INDEX "FeeCharge_branchId_idx" ON "FeeCharge"("branchId");
CREATE INDEX "FeeCharge_studentId_idx" ON "FeeCharge"("studentId");
CREATE INDEX "FeeCharge_batchId_idx" ON "FeeCharge"("batchId");
CREATE INDEX "FeeCharge_status_idx" ON "FeeCharge"("status");
CREATE INDEX "FeeCharge_dueDate_idx" ON "FeeCharge"("dueDate");
CREATE INDEX "FeeCharge_period_idx" ON "FeeCharge"("period");

-- 5. Create FeeAdjustment Table
CREATE TABLE "FeeAdjustment" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "chargeId" TEXT NOT NULL,
  "type" "FeeAdjustmentType" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "reason" VARCHAR(200) NOT NULL,
  "status" "FeeAdjustmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "voidReason" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidedById" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FeeAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeeAdjustment_amount_check" CHECK ("amount" > 0)
);

CREATE INDEX "FeeAdjustment_branchId_idx" ON "FeeAdjustment"("branchId");
CREATE INDEX "FeeAdjustment_chargeId_idx" ON "FeeAdjustment"("chargeId");
CREATE INDEX "FeeAdjustment_status_idx" ON "FeeAdjustment"("status");

-- 6. Create Payment Table (Immutable)
CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "receiptNumber" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "reference" TEXT,
  "note" TEXT,
  "receivedById" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "source" "PaymentSource" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Payment_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "Payment_receiptNumber_key" ON "Payment"("receiptNumber");
CREATE UNIQUE INDEX "Payment_receivedById_idempotencyKey_key" 
  ON "Payment"("receivedById", "idempotencyKey") 
  WHERE "idempotencyKey" IS NOT NULL;

CREATE INDEX "Payment_branchId_idx" ON "Payment"("branchId");
CREATE INDEX "Payment_studentId_idx" ON "Payment"("studentId");
CREATE INDEX "Payment_receivedAt_idx" ON "Payment"("receivedAt");
CREATE INDEX "Payment_receivedById_idx" ON "Payment"("receivedById");

-- 7. Create PaymentAllocation Table
CREATE TABLE "PaymentAllocation" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "chargeId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentAllocation_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "PaymentAllocation_paymentId_chargeId_key" UNIQUE ("paymentId", "chargeId")
);

CREATE INDEX "PaymentAllocation_branchId_idx" ON "PaymentAllocation"("branchId");
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");
CREATE INDEX "PaymentAllocation_chargeId_idx" ON "PaymentAllocation"("chargeId");

-- 8. Create PaymentReversal Table
CREATE TABLE "PaymentReversal" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "reversedById" TEXT NOT NULL,
  "reversedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentReversal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentReversal_paymentId_key" UNIQUE ("paymentId")
);

CREATE INDEX "PaymentReversal_branchId_idx" ON "PaymentReversal"("branchId");

-- 9. Create ReceiptSequence Table
CREATE TABLE "ReceiptSequence" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "lastNumber" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "ReceiptSequence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReceiptSequence_branchId_year_key" UNIQUE ("branchId", "year")
);

-- 10. Foreign Key Constraints
ALTER TABLE "FeeCharge"
  ADD CONSTRAINT "FeeCharge_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FeeCharge_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FeeCharge_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FeeCharge_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "FeeCharge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FeeCharge_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FeeAdjustment"
  ADD CONSTRAINT "FeeAdjustment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FeeAdjustment_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "FeeCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FeeAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FeeAdjustment_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Payment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Payment_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentAllocation"
  ADD CONSTRAINT "PaymentAllocation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentAllocation_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "FeeCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentReversal"
  ADD CONSTRAINT "PaymentReversal_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentReversal_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentReversal_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReceiptSequence"
  ADD CONSTRAINT "ReceiptSequence_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 11. Allocation sum per payment constraint trigger
CREATE OR REPLACE FUNCTION check_payment_allocation_sum()
RETURNS TRIGGER AS $$
DECLARE
  v_total_allocated NUMERIC(12,2);
  v_payment_amount NUMERIC(12,2);
BEGIN
  SELECT amount INTO v_payment_amount FROM "Payment" WHERE id = NEW."paymentId";
  SELECT COALESCE(SUM(amount), 0) INTO v_total_allocated FROM "PaymentAllocation" WHERE "paymentId" = NEW."paymentId";
  IF v_total_allocated > v_payment_amount THEN
    RAISE EXCEPTION 'Total allocated amount (%) cannot exceed payment amount (%)', v_total_allocated, v_payment_amount;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_payment_allocation_sum_trigger
AFTER INSERT OR UPDATE ON "PaymentAllocation"
FOR EACH ROW EXECUTE FUNCTION check_payment_allocation_sum();

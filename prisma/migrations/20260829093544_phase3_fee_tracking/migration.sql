-- CreateEnum
CREATE TYPE "FeeType" AS ENUM ('MONTHLY', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('DUE', 'PARTIAL', 'PAID');

-- AlterEnum
ALTER TYPE "TestType" ADD VALUE 'OFFLINE';

-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "feeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "feeType" "FeeType" NOT NULL DEFAULT 'MONTHLY';

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN     "customFeeAmount" DOUBLE PRECISION,
ADD COLUMN     "discountReason" TEXT,
ADD COLUMN     "discountType" "DiscountType",
ADD COLUMN     "discountValue" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "FeePayment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amountDue" DOUBLE PRECISION NOT NULL,
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "PaymentStatus" NOT NULL DEFAULT 'DUE',
    "dueDate" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "recordedById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeePayment_studentId_batchId_period_key" ON "FeePayment"("studentId", "batchId", "period");

-- AddForeignKey
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

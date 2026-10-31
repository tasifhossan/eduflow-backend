-- CreateEnum
CREATE TYPE "EnquiryStage" AS ENUM ('NEW', 'CONTACTED', 'VISIT_SCHEDULED', 'TRIAL', 'ADMITTED', 'LOST');

-- CreateEnum
CREATE TYPE "EnquiryNoteKind" AS ENUM ('NOTE', 'CALL', 'VISIT');

-- AlterTable
ALTER TABLE "ContactMessage" ADD COLUMN "stage" "EnquiryStage" NOT NULL DEFAULT 'NEW',
ADD COLUMN "branchId" TEXT,
ADD COLUMN "preferredBranchId" TEXT,
ADD COLUMN "assignedToId" TEXT,
ADD COLUMN "followUpAt" TIMESTAMP(3),
ADD COLUMN "lostReason" TEXT,
ADD COLUMN "convertedStudentId" TEXT,
ADD COLUMN "guardianName" TEXT;

-- Update existing rows based on old status
UPDATE "ContactMessage" SET "stage" = 'CONTACTED' WHERE "status" IN ('READ', 'REPLIED');
UPDATE "ContactMessage" SET "stage" = 'LOST', "lostReason" = 'Archived contact message' WHERE "status" = 'ARCHIVED';

-- Backfill branchId from interestedBatch where available
UPDATE "ContactMessage" cm
SET "branchId" = b."branchId"
FROM "Batch" b
WHERE cm."interestedBatchId" = b."id" AND cm."branchId" IS NULL;

-- CreateTable
CREATE TABLE "EnquiryNote" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" "EnquiryNoteKind" NOT NULL DEFAULT 'NOTE',
    "body" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnquiryNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactMessage_branchId_stage_idx" ON "ContactMessage"("branchId", "stage");
CREATE INDEX "ContactMessage_assignedToId_idx" ON "ContactMessage"("assignedToId");
CREATE INDEX "ContactMessage_followUpAt_idx" ON "ContactMessage"("followUpAt");
CREATE INDEX "ContactMessage_phone_idx" ON "ContactMessage"("phone");
CREATE INDEX "EnquiryNote_enquiryId_createdAt_idx" ON "EnquiryNote"("enquiryId", "createdAt");
CREATE INDEX "EnquiryNote_authorId_idx" ON "EnquiryNote"("authorId");

-- AddForeignKey
ALTER TABLE "ContactMessage" ADD CONSTRAINT "ContactMessage_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContactMessage" ADD CONSTRAINT "ContactMessage_preferredBranchId_fkey" FOREIGN KEY ("preferredBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContactMessage" ADD CONSTRAINT "ContactMessage_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContactMessage" ADD CONSTRAINT "ContactMessage_convertedStudentId_fkey" FOREIGN KEY ("convertedStudentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EnquiryNote" ADD CONSTRAINT "EnquiryNote_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "ContactMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnquiryNote" ADD CONSTRAINT "EnquiryNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "CenterSettings" ADD COLUMN     "homepage" JSONB NOT NULL DEFAULT '{"heroTitle":"","heroSubtitle":"","heroImageUrl":null,"announcement":{"enabled":false,"text":"","linkLabel":"","linkUrl":""},"highlights":[],"whyChooseUs":[],"admissionSteps":[],"showFees":true,"showPhotoGallery":true}';

-- AlterTable
ALTER TABLE "ContactMessage" ADD COLUMN     "interestedBatchId" TEXT,
ADD COLUMN     "interestedGrade" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'WEBSITE',
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "subject" DROP NOT NULL,
ALTER COLUMN "message" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "ContactMessage_interestedBatchId_idx" ON "ContactMessage"("interestedBatchId");

-- AddForeignKey
ALTER TABLE "ContactMessage" ADD CONSTRAINT "ContactMessage_interestedBatchId_fkey" FOREIGN KEY ("interestedBatchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "StudyMaterialType" AS ENUM (
    'PREPARATION',
    'NOTES',
    'SLIDES',
    'PRACTICE',
    'QUESTIONS',
    'REFERENCE',
    'RECORDING',
    'OTHER'
);

-- CreateTable
CREATE TABLE "StudyMaterial" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "chapterId" TEXT,
    "lectureId" TEXT,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "type" "StudyMaterialType" NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "availableFrom" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "legacyResourceId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialAttachment" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "publicId" TEXT,
    "resourceType" TEXT,
    "format" TEXT,
    "bytes" INTEGER,
    "originalName" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialAccess" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "firstAccessAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAccessAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accessCount" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "MaterialAccess_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "CenterSettings" ALTER COLUMN "features" SET DEFAULT '{"publicSite":true,"aiAssistant":true,"blog":true,"reviews":true,"testimonials":true,"newsletter":false,"showPoweredBy":true,"lectures":true,"assignments":true,"onlineClasses":true,"attendanceAlerts":true,"materials":true}';

-- CreateIndex
CREATE UNIQUE INDEX "StudyMaterial_legacyResourceId_key" ON "StudyMaterial"("legacyResourceId");

-- CreateIndex
CREATE INDEX "StudyMaterial_batchId_chapterId_idx" ON "StudyMaterial"("batchId", "chapterId");

-- CreateIndex
CREATE INDEX "StudyMaterial_batchId_isPublished_availableFrom_idx" ON "StudyMaterial"("batchId", "isPublished", "availableFrom");

-- CreateIndex
CREATE INDEX "StudyMaterial_branchId_idx" ON "StudyMaterial"("branchId");

-- CreateIndex
CREATE INDEX "MaterialAttachment_materialId_idx" ON "MaterialAttachment"("materialId");

-- CreateIndex
CREATE INDEX "MaterialAttachment_uploadedById_idx" ON "MaterialAttachment"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialAccess_materialId_studentId_key" ON "MaterialAccess"("materialId", "studentId");

-- CreateIndex
CREATE INDEX "MaterialAccess_materialId_idx" ON "MaterialAccess"("materialId");

-- CreateIndex
CREATE INDEX "MaterialAccess_studentId_idx" ON "MaterialAccess"("studentId");

-- Check Constraints for MaterialAttachment
ALTER TABLE "MaterialAttachment" ADD CONSTRAINT "MaterialAttachment_kind_content_check" CHECK (
    ("kind" = 'LINK' AND "url" IS NOT NULL AND "publicId" IS NULL) OR
    ("kind" = 'FILE' AND "publicId" IS NOT NULL)
);

-- AddForeignKey
ALTER TABLE "StudyMaterial" ADD CONSTRAINT "StudyMaterial_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMaterial" ADD CONSTRAINT "StudyMaterial_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMaterial" ADD CONSTRAINT "StudyMaterial_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMaterial" ADD CONSTRAINT "StudyMaterial_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMaterial" ADD CONSTRAINT "StudyMaterial_lectureId_fkey" FOREIGN KEY ("lectureId") REFERENCES "Lecture"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMaterial" ADD CONSTRAINT "StudyMaterial_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMaterial" ADD CONSTRAINT "StudyMaterial_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMaterial" ADD CONSTRAINT "StudyMaterial_legacyResourceId_fkey" FOREIGN KEY ("legacyResourceId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialAttachment" ADD CONSTRAINT "MaterialAttachment_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "StudyMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialAttachment" ADD CONSTRAINT "MaterialAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialAccess" ADD CONSTRAINT "MaterialAccess_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "StudyMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialAccess" ADD CONSTRAINT "MaterialAccess_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

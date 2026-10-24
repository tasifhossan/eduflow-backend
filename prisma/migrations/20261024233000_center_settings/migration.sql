-- CreateTable
CREATE TABLE "CenterSettings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'center',
    "name" TEXT NOT NULL DEFAULT 'EduFlow Coaching',
    "shortName" TEXT NOT NULL DEFAULT 'EduFlow',
    "tagline" TEXT NOT NULL DEFAULT 'Modern Coaching Center Management Platform',
    "logoUrl" TEXT,
    "faviconUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#4f46e5',
    "contactEmail" TEXT NOT NULL DEFAULT 'contact@eduflow.local',
    "contactPhone" TEXT NOT NULL DEFAULT '01700000000',
    "whatsapp" TEXT,
    "address" TEXT NOT NULL DEFAULT 'Dhaka, Bangladesh',
    "socials" JSONB,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "currencySymbol" TEXT NOT NULL DEFAULT '৳',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dhaka',
    "defaultLocale" TEXT NOT NULL DEFAULT 'en',
    "academicYearStartMonth" INTEGER NOT NULL DEFAULT 1,
    "receiptHeader" TEXT,
    "receiptFooter" TEXT,
    "features" JSONB NOT NULL DEFAULT '{"publicSite":true,"aiAssistant":true,"blog":true,"reviews":true,"testimonials":true,"newsletter":true,"showPoweredBy":true}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CenterSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CenterSettings_key_key" ON "CenterSettings"("key");

-- Insert default row if not exists
INSERT INTO "CenterSettings" ("id", "key", "name", "shortName", "tagline", "primaryColor", "contactEmail", "contactPhone", "address", "currency", "currencySymbol", "timezone", "defaultLocale", "academicYearStartMonth", "features", "updatedAt")
VALUES ('default-center-settings', 'center', 'EduFlow Coaching', 'EduFlow', 'Modern Coaching Center Management Platform', '#4f46e5', 'contact@eduflow.local', '01700000000', 'Dhaka, Bangladesh', 'BDT', '৳', 'Asia/Dhaka', 'en', 1, '{"publicSite":true,"aiAssistant":true,"blog":true,"reviews":true,"testimonials":true,"newsletter":true,"showPoweredBy":true}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

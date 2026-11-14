-- CMS content management: FAQ/testimonial drafts + consent, blog scheduling audit,
-- review visibility, teacher public profile fields.
-- Hand-written. Existing rows stay valid and visible.

-- Safety guard: abort (instead of truncating) if existing rows exceed the new length limits.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "FaqItem" WHERE length("question") > 200 OR length("answer") > 2000)
     OR EXISTS (SELECT 1 FROM "Testimonial" WHERE length("content") > 500) THEN
    RAISE EXCEPTION 'CMS migration aborted: existing FaqItem/Testimonial rows exceed the new length limits';
  END IF;
END $$;

-- FaqItem
ALTER TABLE "FaqItem"
  ALTER COLUMN "question" TYPE VARCHAR(200),
  ALTER COLUMN "answer" TYPE VARCHAR(2000),
  ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedById" TEXT;

-- Testimonial
ALTER TABLE "Testimonial"
  ALTER COLUMN "content" TYPE VARCHAR(500),
  ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "hasConsent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedById" TEXT;

-- Existing testimonials were already public: keep them visible.
UPDATE "Testimonial" SET "hasConsent" = true;

-- BlogPost
ALTER TABLE "BlogPost" ADD COLUMN "updatedById" TEXT;

-- Public visibility is now (isPublished AND publishedAt <= now()).
-- Published posts with no date would become invisible; give them their creation date.
UPDATE "BlogPost" SET "publishedAt" = "createdAt" WHERE "isPublished" = true AND "publishedAt" IS NULL;

-- Review
ALTER TABLE "Review"
  ADD COLUMN "isHidden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "hiddenById" TEXT,
  ADD COLUMN "hiddenReason" VARCHAR(200),
  ADD COLUMN "hiddenAt" TIMESTAMP(3);

-- User
ALTER TABLE "User"
  ADD COLUMN "qualifications" VARCHAR(200),
  ADD COLUMN "experienceYears" INTEGER,
  ADD COLUMN "publicOrder" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "User_experienceYears_range" CHECK ("experienceYears" IS NULL OR ("experienceYears" >= 0 AND "experienceYears" <= 60));

-- Indexes for the new filter columns
CREATE INDEX "FaqItem_isPublished_sortOrder_idx" ON "FaqItem"("isPublished", "sortOrder");
CREATE INDEX "Testimonial_isPublished_hasConsent_sortOrder_idx" ON "Testimonial"("isPublished", "hasConsent", "sortOrder");
CREATE INDEX "Review_batchId_isHidden_idx" ON "Review"("batchId", "isHidden");
CREATE INDEX "User_role_isPublicProfile_publicOrder_idx" ON "User"("role", "isPublicProfile", "publicOrder");

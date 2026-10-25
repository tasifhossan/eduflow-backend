-- AlterTable
ALTER TABLE "CenterSettings" ALTER COLUMN "name" SET DEFAULT 'Coaching Center',
ALTER COLUMN "shortName" SET DEFAULT 'Center',
ALTER COLUMN "tagline" SET DEFAULT '',
ALTER COLUMN "contactEmail" SET DEFAULT '',
ALTER COLUMN "contactPhone" SET DEFAULT '',
ALTER COLUMN "address" SET DEFAULT '',
ALTER COLUMN "features" SET DEFAULT '{"publicSite":true,"aiAssistant":true,"blog":true,"reviews":true,"testimonials":true,"newsletter":false,"showPoweredBy":true}',
ALTER COLUMN "homepage" SET DEFAULT '{"heroBadge":"","heroPoints":[],"heroTitle":"","heroSubtitle":"","heroImageUrl":null,"announcement":{"enabled":false,"text":"","linkLabel":"","linkUrl":""},"highlights":[],"whyChooseUs":[],"admissionSteps":[],"showFees":true,"showPhotoGallery":true}';

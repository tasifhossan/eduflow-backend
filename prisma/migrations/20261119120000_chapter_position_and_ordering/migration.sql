-- AlterTable
ALTER TABLE "Chapter" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Chapter" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill existing positions per subject by creation order (id order)
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "subjectId" ORDER BY "createdAt" ASC, "id" ASC) - 1 AS new_pos
  FROM "Chapter"
)
UPDATE "Chapter" c
SET "position" = r.new_pos
FROM ranked r
WHERE c.id = r.id;

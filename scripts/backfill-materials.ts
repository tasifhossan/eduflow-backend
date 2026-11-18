import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient, StudyMaterialType } from '@prisma/client';

const prisma = new PrismaClient();

export function guessMaterialType(fileUrl: string, fileType?: string | null): StudyMaterialType {
  const urlLower = (fileUrl || '').toLowerCase();
  const ext = (urlLower.split('.').pop() || '').split('?')[0];
  const mime = (fileType || '').toLowerCase();

  if (['ppt', 'pptx', 'key'].includes(ext) || mime.includes('presentation') || mime.includes('powerpoint')) {
    return StudyMaterialType.SLIDES;
  }
  if (
    ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext) ||
    mime.includes('document') ||
    mime.includes('word') ||
    mime.includes('pdf')
  ) {
    return StudyMaterialType.NOTES;
  }
  if (
    ['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(ext) ||
    mime.includes('video') ||
    urlLower.includes('youtube.com') ||
    urlLower.includes('youtu.be') ||
    urlLower.includes('vimeo.com')
  ) {
    return StudyMaterialType.RECORDING;
  }
  if (['xlsx', 'xls', 'csv'].includes(ext) || mime.includes('sheet') || mime.includes('excel')) {
    return StudyMaterialType.REFERENCE;
  }
  return StudyMaterialType.OTHER;
}

export async function backfillLegacyResources(): Promise<{
  total: number;
  migrated: number;
  skipped: number;
}> {
  console.log('[backfill-materials] Starting legacy Resource backfill...');

  const resources = await prisma.resource.findMany({
    include: {
      batch: {
        select: {
          id: true,
          branchId: true,
          subjectId: true,
        },
      },
      chapter: {
        select: {
          id: true,
          subjectId: true,
        },
      },
    },
  });

  let migrated = 0;
  let skipped = 0;

  for (const resource of resources) {
    // Check if already migrated (idempotent through legacyResourceId)
    const existing = await prisma.studyMaterial.findUnique({
      where: { legacyResourceId: resource.id },
    });

    if (existing) {
      skipped++;
      continue;
    }

    const type = guessMaterialType(resource.fileUrl, resource.fileType);
    const chapterId =
      resource.chapter && resource.chapter.subjectId === resource.batch.subjectId
        ? resource.chapterId
        : null;

    // Determine sortOrder
    const maxSort = await prisma.studyMaterial.findFirst({
      where: { batchId: resource.batchId, chapterId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const nextSortOrder = (maxSort?.sortOrder ?? -1) + 1;

    // Ensure valid link URL (convert http to https if necessary)
    let url = resource.fileUrl;
    if (url.startsWith('http://')) {
      url = url.replace('http://', 'https://');
    }

    await prisma.studyMaterial.create({
      data: {
        branchId: resource.batch.branchId,
        batchId: resource.batchId,
        subjectId: resource.batch.subjectId,
        chapterId,
        title: resource.title.slice(0, 120),
        type,
        isPublished: true,
        availableFrom: resource.createdAt,
        sortOrder: nextSortOrder,
        legacyResourceId: resource.id,
        createdById: resource.uploadedById,
        createdAt: resource.createdAt,
        attachments: {
          create: [
            {
              kind: 'LINK',
              title: resource.title.slice(0, 120),
              url,
              uploadedById: resource.uploadedById,
              createdAt: resource.createdAt,
            },
          ],
        },
      },
    });

    migrated++;
  }

  if (migrated > 0) {
    await prisma.auditLog.create({
      data: {
        action: 'STUDY_MATERIAL_BACKFILL',
        entityType: 'StudyMaterial',
        metadata: {
          totalResources: resources.length,
          migratedCount: migrated,
          skippedCount: skipped,
        },
      },
    });
  }

  console.log(`[backfill-materials] Total Resources: ${resources.length}`);
  console.log(`[backfill-materials] Newly Migrated: ${migrated}`);
  console.log(`[backfill-materials] Already Migrated (Skipped): ${skipped}`);

  return {
    total: resources.length,
    migrated,
    skipped,
  };
}

if (require.main === module) {
  backfillLegacyResources()
    .then(() => {
      console.log('[backfill-materials] Backfill complete.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[backfill-materials] Backfill failed:', err);
      process.exit(1);
    });
}

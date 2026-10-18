import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'batch';
}

async function main() {
  console.log('Starting batch slug backfill...');

  const batches = await prisma.batch.findMany({
    orderBy: { createdAt: 'asc' },
  });

  const usedSlugs = new Set<string>();

  // Collect existing non-null slugs
  for (const b of batches) {
    if (b.slug) {
      usedSlugs.add(b.slug);
    }
  }

  let updatedCount = 0;

  for (const batch of batches) {
    if (!batch.slug) {
      let baseSlug = slugify(batch.name);
      let candidateSlug = baseSlug;
      let counter = 1;

      while (usedSlugs.has(candidateSlug)) {
        counter += 1;
        candidateSlug = `${baseSlug}-${counter}`;
      }

      await prisma.batch.update({
        where: { id: batch.id },
        data: { slug: candidateSlug },
      });

      usedSlugs.add(candidateSlug);
      updatedCount += 1;
      console.log(`Updated batch "${batch.name}" (${batch.id}) -> slug: "${candidateSlug}"`);
    }
  }

  console.log(`Backfill completed. ${updatedCount} batches updated.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('Backfill error:', e);
    await prisma.$disconnect();
    process.exit(1);
  });

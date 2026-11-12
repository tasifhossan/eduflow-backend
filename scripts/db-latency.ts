import dotenv from 'dotenv';
dotenv.config();

import prisma from '../src/utils/prisma';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

async function main() {
  console.log('Running 20 x SELECT 1 DB round-trip latency measurements...');
  const times: number[] = [];

  for (let i = 1; i <= 20; i++) {
    const start = performance.now();
    await prisma.$queryRaw`SELECT 1`;
    const ms = Number((performance.now() - start).toFixed(2));
    times.push(ms);
    console.log(`  [${String(i).padStart(2, '0')}/20] ${ms} ms`);
  }

  const sorted = [...times].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2))
    : sorted[mid];
  const p95 = percentile(sorted, 95);

  console.log('-'.repeat(50));
  console.log(`Min:    ${sorted[0]} ms`);
  console.log(`Median: ${median} ms`);
  console.log(`p95:    ${p95} ms`);
  console.log(`Max:    ${sorted[sorted.length - 1]} ms`);
}

main()
  .catch((err) => {
    console.error('db:latency error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


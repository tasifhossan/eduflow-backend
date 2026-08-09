import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env
dotenv.config({ path: path.join(__dirname, '../.env') });

const sourceUrl = process.env.DATABASE_URL;
const targetUrl = process.env.NEON_DATABASE_URL;
const targetDirectUrl = process.env.NEON_DIRECT_URL;

if (!sourceUrl) {
  console.error("Error: DATABASE_URL is not defined in .env file.");
  process.exit(1);
}

if (!targetUrl || !targetDirectUrl) {
  console.error("Error: NEON_DATABASE_URL and NEON_DIRECT_URL must be defined in .env file.");
  process.exit(1);
}

const models = [
  'branch',
  'subject',
  'user',
  'chapter',
  'batch',
  'enrollment',
  'routineSlot',
  'attendance',
  'test',
  'question',
  'option',
  'studentAnswer',
  'result',
] as const;

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunked: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunked.push(array.slice(i, i + size));
  }
  return chunked;
}

async function main() {
  console.log("--------------------------------------------------");
  console.log("Step 1: Deploying database schema to NeonDB...");
  console.log("--------------------------------------------------");
  
  try {
    execSync('npx prisma migrate deploy', {
      env: {
        ...process.env,
        DATABASE_URL: targetUrl,
        DIRECT_URL: targetDirectUrl,
      },
      stdio: 'inherit',
    });
    console.log("Schema deployment successful!");
  } catch (error) {
    console.error("Failed to deploy schema to NeonDB:", error);
    process.exit(1);
  }

  console.log("\n--------------------------------------------------");
  console.log("Step 2: Connecting to databases...");
  console.log("--------------------------------------------------");

  const sourceDb = new PrismaClient({
    datasources: {
      db: {
        url: sourceUrl,
      },
    },
  });

  const targetDb = new PrismaClient({
    datasources: {
      db: {
        url: targetUrl,
      },
    },
  });

  try {
    await sourceDb.$connect();
    console.log("Connected to source database (Supabase).");
    await targetDb.$connect();
    console.log("Connected to target database (NeonDB).");

    console.log("\n--------------------------------------------------");
    console.log("Step 3: Cleaning existing data in NeonDB...");
    console.log("--------------------------------------------------");

    // Deleting in reverse topological order to respect constraints
    const reverseModels = [...models].reverse();
    for (const model of reverseModels) {
      console.log(`Clearing target table: ${model}...`);
      await (targetDb[model] as any).deleteMany({});
    }
    console.log("Target database cleaned successfully.");

    console.log("\n--------------------------------------------------");
    console.log("Step 4: Migrating data table by table...");
    console.log("--------------------------------------------------");

    for (const model of models) {
      console.log(`Migrating table: ${model}...`);
      const records = await (sourceDb[model] as any).findMany({});
      
      if (records.length === 0) {
        console.log(`  No records found in source for ${model}.`);
        continue;
      }

      console.log(`  Found ${records.length} records in source. Copying...`);
      
      const chunks = chunkArray(records, 200);
      for (const chunk of chunks) {
        await (targetDb[model] as any).createMany({
          data: chunk,
        });
      }
      console.log(`  Successfully migrated ${records.length} records for ${model}.`);
    }

    console.log("\n--------------------------------------------------");
    console.log("Step 5: Verifying record counts...");
    console.log("--------------------------------------------------");

    let verificationPassed = true;
    for (const model of models) {
      const sourceCount = await (sourceDb[model] as any).count({});
      const targetCount = await (targetDb[model] as any).count({});
      
      if (sourceCount === targetCount) {
        console.log(`✔ ${model}: ${sourceCount} records (Match)`);
      } else {
        console.error(`✘ ${model}: MISMATCH! Source: ${sourceCount}, Target: ${targetCount}`);
        verificationPassed = false;
      }
    }

    if (verificationPassed) {
      console.log("\nMigration completed successfully! All table counts match.");
    } else {
      console.error("\nMigration completed with count mismatches. Please check errors above.");
      process.exit(1);
    }

  } catch (error) {
    console.error("An error occurred during migration:", error);
    process.exit(1);
  } finally {
    await sourceDb.$disconnect();
    await targetDb.$disconnect();
  }
}

main();

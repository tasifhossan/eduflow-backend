import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

const prisma = new PrismaClient();

function generateRandomPassword(length = 14): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars[crypto.randomInt(0, chars.length)];
  }
  return password;
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  // 0. Schema check: it must NOT run migrations; fail with clear message if not up to date
  try {
    const migrationsDir = path.resolve(__dirname, '../prisma/migrations');
    const diskMigrations = fs.existsSync(migrationsDir)
      ? fs.readdirSync(migrationsDir).filter((f) => fs.statSync(path.join(migrationsDir, f)).isDirectory() && !f.startsWith('.'))
      : [];

    const applied = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
      SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
    `;
    const appliedNames = new Set(applied.map((m) => m.migration_name));
    const unapplied = diskMigrations.filter((name) => !appliedNames.has(name));

    if (unapplied.length > 0) {
      console.error('Database schema is not up to date. Please run prisma migrate deploy first.');
      process.exit(1);
    }
  } catch (err) {
    console.error('Database schema is not up to date. Please run prisma migrate deploy first.');
    process.exit(1);
  }

  // 1. Guard check: Refuse if center settings or users already exist
  const existingSettings = await prisma.centerSettings.findUnique({
    where: { key: 'center' },
  });
  const userCount = await prisma.user.count();

  if (existingSettings || userCount > 0) {
    console.error('Refusing to initialize: center already initialized or users exist in database.');
    process.exit(1);
  }

  // 2. Read environment variables
  const centerName = process.env.CENTER_NAME?.trim();
  const centerEmail = (process.env.CENTER_CONTACT_EMAIL || process.env.CENTER_EMAIL)?.trim();
  const centerPhone = (process.env.CENTER_CONTACT_PHONE || process.env.CENTER_PHONE)?.trim();
  const ownerName = process.env.OWNER_NAME?.trim();
  const ownerEmail = process.env.OWNER_EMAIL?.trim();
  const ownerPhone = process.env.OWNER_PHONE?.trim();

  const missing: string[] = [];
  if (!centerName) missing.push('CENTER_NAME');
  if (!centerEmail) missing.push('CENTER_CONTACT_EMAIL (or CENTER_EMAIL)');
  if (!centerPhone) missing.push('CENTER_CONTACT_PHONE (or CENTER_PHONE)');
  if (!ownerName) missing.push('OWNER_NAME');
  if (!ownerEmail) missing.push('OWNER_EMAIL');

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  const centerShortName =
    process.env.CENTER_SHORT_NAME?.trim() ||
    centerName!
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 10);
  const centerSlogan = (process.env.CENTER_SLOGAN || process.env.CENTER_TAGLINE)?.trim() || null;
  const centerAddress = (process.env.CENTER_ADDRESS || process.env.FIRST_BRANCH_ADDRESS)?.trim() || null;
  const primaryColor = process.env.CENTER_PRIMARY_COLOR?.trim() || '#0ea5e9';
  const accentColor = process.env.CENTER_ACCENT_COLOR?.trim() || '#10b981';
  const currencyCode = process.env.CURRENCY_CODE?.trim() || 'BDT';
  const currencySymbol = process.env.CURRENCY_SYMBOL?.trim() || '৳';

  const branchName = (process.env.FIRST_BRANCH_NAME || process.env.BRANCH_NAME)?.trim() || 'Main Branch';
  const branchCode = process.env.BRANCH_CODE?.trim() || 'MAIN';
  const branchAddress = (process.env.FIRST_BRANCH_ADDRESS || process.env.BRANCH_ADDRESS || centerAddress)?.trim() || null;

  const ownerPasswordProvided = process.env.OWNER_PASSWORD?.trim();
  if (ownerPasswordProvided && ownerPasswordProvided.length < 12) {
    console.error('OWNER_PASSWORD must be at least 12 characters');
    process.exit(1);
  }
  const generatedPassword = ownerPasswordProvided ? null : generateRandomPassword(14);
  const finalPassword = ownerPasswordProvided || generatedPassword!;

  if (isDryRun) {
    console.log('DRY RUN: Validation passed. Center initialization would succeed.');
    console.log(`- Center: ${centerName} (${centerShortName})`);
    console.log(`- Branch: ${branchName} [${branchCode}]`);
    console.log(`- Owner: ${ownerName} <${ownerEmail}>`);
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(finalPassword, 10);

  // 3. Transactional initialization
  const result = await prisma.$transaction(async (tx) => {
    // 3a. Create Center Settings
    const settings = await tx.centerSettings.create({
      data: {
        key: 'center',
        name: centerName!,
        shortName: centerShortName,
        tagline: centerSlogan || '',
        contactEmail: centerEmail!,
        contactPhone: centerPhone!,
        address: centerAddress || '',
        primaryColor,
        currency: currencyCode,
        currencySymbol,
        features: {
          publicSite: true,
          aiAssistant: true,
          blog: true,
          reviews: true,
          testimonials: true,
          newsletter: false,
          showPoweredBy: true,
        },
        homepage: {
          heroBadge: '',
          heroPoints: [],
          heroTitle: '',
          heroSubtitle: '',
          heroImageUrl: null,
          announcement: { enabled: false, text: '', linkLabel: '', linkUrl: '' },
          highlights: [],
          whyChooseUs: [],
          admissionSteps: [],
          showFees: true,
          showPhotoGallery: true,
        },
      },
    });

    // 3b. Create First Branch
    const branch = await tx.branch.create({
      data: {
        name: branchName,
        code: branchCode,
        address: branchAddress,
      },
    });

    // 3c. Create SUPER_ADMIN User
    const owner = await tx.user.create({
      data: {
        name: ownerName!,
        email: ownerEmail!,
        phone: ownerPhone!,
        role: Role.SUPER_ADMIN,
        branchId: branch.id,
        password: passwordHash,
        isActive: true,
        mustChangePassword: !!generatedPassword, // require change on first login if randomly generated
      },
    });

    return { settings, branch, owner };
  });

  console.log('================================================================');
  console.log(' CENTER INITIALIZATION COMPLETE');
  console.log('================================================================');
  console.log(`Center Name:       ${result.settings.name}`);
  console.log(`Short Name:        ${result.settings.shortName}`);
  console.log(`Branch:            ${result.branch.name} (Code: ${result.branch.code || 'N/A'})`);
  console.log(`Super Admin User:  ${result.owner.name} <${result.owner.email}>`);
  if (generatedPassword) {
    console.log('----------------------------------------------------------------');
    console.log(`Temporary Password: ${generatedPassword}`);
    console.log('IMPORTANT: Please save this password. It will not be shown again.');
    console.log('The super admin will be required to change it upon first login.');
    console.log('----------------------------------------------------------------');
  } else {
    console.log('Password:          [Set from OWNER_PASSWORD environment variable]');
  }
  console.log('================================================================');
}

main()
  .catch((e) => {
    console.error('Initialization failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

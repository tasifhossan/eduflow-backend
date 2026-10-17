import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD;

  if (!email || !password) {
    console.error('Error: SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD environment variables are required.');
    process.exit(1);
  }

  if (password.length < 12) {
    console.error('Error: SUPERADMIN_PASSWORD must be at least 12 characters long.');
    process.exit(1);
  }

  // Use the canonical seeded Dhanmondi Branch for the super admin
  let branch = await prisma.branch.findUnique({
    where: { id: 'branch-dhanmondi-branch' },
  });

  if (!branch) {
    branch = await prisma.branch.findFirst({
      orderBy: { createdAt: 'asc' },
    });
  }

  if (!branch) {
    console.error('Error: No branch found in database to associate with SUPER_ADMIN.');
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const superAdmin = await prisma.user.upsert({
    where: { email },
    update: {
      password: hashedPassword,
      role: Role.SUPER_ADMIN,
      branchId: branch.id,
      name: 'Super Administrator',
    },
    create: {
      email,
      password: hashedPassword,
      role: Role.SUPER_ADMIN,
      branchId: branch.id,
      name: 'Super Administrator',
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      branchId: true,
      createdAt: true,
    },
  });

  console.log(`SUPER_ADMIN user successfully created/updated: ${superAdmin.email} (ID: ${superAdmin.id})`);
}

main()
  .catch((err) => {
    console.error('Failed to set superadmin:', err.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

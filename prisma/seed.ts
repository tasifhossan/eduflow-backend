import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create or retrieve "Main Branch"
  let branch = await prisma.branch.findFirst({
    where: { name: 'Main Branch' },
  });

  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        name: 'Main Branch',
      },
    });
    console.log(`Created branch: ${branch.name} (${branch.id})`);
  } else {
    console.log(`Using existing branch: ${branch.name} (${branch.id})`);
  }

  // Hash admin password
  const hashedPassword = await bcrypt.hash('Admin@123', 10);

  // Create or update admin user
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@eduflow.com' },
    update: {
      name: 'Admin User',
      password: hashedPassword,
      role: 'ADMIN',
      branchId: branch.id,
    },
    create: {
      name: 'Admin User',
      email: 'admin@eduflow.com',
      password: hashedPassword,
      role: 'ADMIN',
      branchId: branch.id,
    },
  });

  console.log(`Seeded admin user: ${adminUser.email} (${adminUser.id})`);
  console.log('Seeding complete.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

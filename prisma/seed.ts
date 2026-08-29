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

  // Hash teacher password
  const teacherPassword = await bcrypt.hash('Teacher@123', 10);

  // Create or update teacher user
  const teacherUser = await prisma.user.upsert({
    where: { email: 'teacher@eduflow.com' },
    update: {
      name: 'Teacher User',
      password: teacherPassword,
      role: 'TEACHER',
      branchId: branch.id,
    },
    create: {
      name: 'Teacher User',
      email: 'teacher@eduflow.com',
      password: teacherPassword,
      role: 'TEACHER',
      branchId: branch.id,
    },
  });

  console.log(`Seeded teacher user: ${teacherUser.email} (${teacherUser.id})`);

  // Seed default subjects
  const defaultSubjects = ['Physics', 'Chemistry', 'Higher Mathematics', 'Biology', 'English', 'ICT'];
  for (const subjectName of defaultSubjects) {
    const existing = await prisma.subject.findFirst({
      where: { name: { equals: subjectName, mode: 'insensitive' } },
    });
    if (!existing) {
      const created = await prisma.subject.create({
        data: { name: subjectName },
      });
      console.log(`Seeded subject: ${created.name} (${created.id})`);
    } else {
      console.log(`Using existing subject: ${existing.name} (${existing.id})`);
    }
  }

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

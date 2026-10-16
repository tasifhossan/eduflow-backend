import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  // Demo script is allowed to run in production ONLY when DEMO_MODE=true
  if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') {
    throw new Error('Demo seeding is not allowed in production unless DEMO_MODE is set to true.');
  }

  console.log('Seeding demo environment...');

  // 1. Create or retrieve "Demo Branch"
  let demoBranch = await prisma.branch.findFirst({
    where: { name: 'Demo Branch' },
  });

  if (!demoBranch) {
    demoBranch = await prisma.branch.create({
      data: {
        name: 'Demo Branch',
        address: 'House 42, Road 11, Banani, Dhaka-1213',
      },
    });
    console.log(`Created Demo Branch: ${demoBranch.name} (${demoBranch.id})`);
  } else {
    console.log(`Using existing Demo Branch: ${demoBranch.name} (${demoBranch.id})`);
  }

  // 2. Demo users definitions - random passwords are never printed or stored anywhere
  const demoUsers = [
    {
      name: 'Demo Administrator',
      email: 'admin@demo.eduflow.local',
      role: Role.ADMIN,
      phone: '01700000001',
    },
    {
      name: 'Demo Teacher',
      email: 'teacher@demo.eduflow.local',
      role: Role.TEACHER,
      phone: '01700000002',
    },
    {
      name: 'Demo Student',
      email: 'student@demo.eduflow.local',
      role: Role.STUDENT,
      phone: '01700000003',
      guardianName: 'Demo Guardian Parent',
      guardianPhone: '01700000004',
    },
    {
      name: 'Demo Guardian',
      email: 'guardian@demo.eduflow.local',
      role: Role.GUARDIAN,
      phone: '01700000004',
    },
  ];

  for (const u of demoUsers) {
    // Generate an unprinted cryptographically secure random password and hash it directly
    const randomSecret = crypto.randomBytes(32).toString('hex');
    const hashedPassword = await bcrypt.hash(randomSecret, 10);

    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        role: u.role,
        branchId: demoBranch.id,
        phone: u.phone,
        guardianName: (u as any).guardianName || null,
        guardianPhone: (u as any).guardianPhone || null,
        password: hashedPassword,
      },
      create: {
        name: u.name,
        email: u.email,
        role: u.role,
        branchId: demoBranch.id,
        phone: u.phone,
        guardianName: (u as any).guardianName || null,
        guardianPhone: (u as any).guardianPhone || null,
        password: hashedPassword,
      },
    });

    console.log(`Configured demo account: ${user.email} (${user.role})`);
  }

  console.log('Demo branch and accounts setup complete.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('Demo seed error:', e);
    await prisma.$disconnect();
    process.exit(1);
  });

import { PrismaClient, Role, BatchType, FeeType, DayOfWeek, AttendanceStatus, PaymentStatus, TestType, QuestionType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') {
    throw new Error('Demo seeding is not allowed in production unless DEMO_MODE is set to true.');
  }

  const isReset = process.argv.includes('--reset');
  console.log(`Seeding demo environment... (mode: ${isReset ? 'RESET & SEED' : 'IDEMPOTENT UPSERT'})`);

  // 1. Retrieve or create Demo Branch
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

  // Handle --reset if requested
  if (isReset) {
    console.log('Reset flag detected. Purging previous Demo Branch data...');
    const demoBatches = await prisma.batch.findMany({
      where: { branchId: demoBranch.id },
      select: { id: true },
    });
    const demoBatchIds = demoBatches.map((b) => b.id);

    if (demoBatchIds.length > 0) {
      // Delete tests and dependent rows
      const tests = await prisma.test.findMany({
        where: { batchId: { in: demoBatchIds } },
        select: { id: true },
      });
      const testIds = tests.map((t) => t.id);
      if (testIds.length > 0) {
        await prisma.result.deleteMany({ where: { testId: { in: testIds } } });
        await prisma.studentAnswer.deleteMany({ where: { question: { testId: { in: testIds } } } });
        await prisma.option.deleteMany({ where: { question: { testId: { in: testIds } } } });
        await prisma.question.deleteMany({ where: { testId: { in: testIds } } });
        await prisma.test.deleteMany({ where: { id: { in: testIds } } });
      }

      await prisma.attendance.deleteMany({ where: { batchId: { in: demoBatchIds } } });
      await prisma.feePayment.deleteMany({ where: { batchId: { in: demoBatchIds } } });
      await prisma.routineSlot.deleteMany({ where: { batchId: { in: demoBatchIds } } });
      await prisma.enrollment.deleteMany({ where: { batchId: { in: demoBatchIds } } });
      await prisma.review.deleteMany({ where: { batchId: { in: demoBatchIds } } });
      await prisma.batch.deleteMany({ where: { id: { in: demoBatchIds } } });
    }

    await prisma.notice.deleteMany({ where: { branchId: demoBranch.id } });
    await prisma.guardianLink.deleteMany({
      where: {
        student: { branchId: demoBranch.id },
      },
    });

    // Delete extra demo students (keep the 4 base demo users)
    const baseDemoEmails = [
      'admin@demo.eduflow.local',
      'teacher@demo.eduflow.local',
      'student@demo.eduflow.local',
      'guardian@demo.eduflow.local',
    ];
    await prisma.user.deleteMany({
      where: {
        branchId: demoBranch.id,
        email: { endsWith: '@demo.eduflow.local', notIn: baseDemoEmails },
      },
    });
    console.log('Reset complete.');
  }

  // 2. Base demo users
  async function makeRandomPasswordHash(): Promise<string> {
    const secret = crypto.randomBytes(32).toString('hex');
    return await bcrypt.hash(secret, 10);
  }

  const baseUsers = [
    { name: 'Demo Administrator', email: 'admin@demo.eduflow.local', role: Role.ADMIN, phone: '01700000001' },
    { name: 'Demo Teacher', email: 'teacher@demo.eduflow.local', role: Role.TEACHER, phone: '01700000002', headline: 'Senior Science Mentor | M.Sc. BUET' },
    { name: 'Demo Student', email: 'student@demo.eduflow.local', role: Role.STUDENT, phone: '01700000003', guardianName: 'Demo Guardian Parent', guardianPhone: '01700000004' },
    { name: 'Demo Guardian', email: 'guardian@demo.eduflow.local', role: Role.GUARDIAN, phone: '01700000004' },
  ];

  const userMap = new Map<string, any>();
  for (const u of baseUsers) {
    const hash = await makeRandomPasswordHash();
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        role: u.role,
        branchId: demoBranch.id,
        phone: u.phone,
        guardianName: (u as any).guardianName || null,
        guardianPhone: (u as any).guardianPhone || null,
        headline: (u as any).headline || null,
      },
      create: {
        name: u.name,
        email: u.email,
        role: u.role,
        branchId: demoBranch.id,
        phone: u.phone,
        guardianName: (u as any).guardianName || null,
        guardianPhone: (u as any).guardianPhone || null,
        headline: (u as any).headline || null,
        password: hash,
      },
    });
    userMap.set(u.email, user);
  }

  const demoAdmin = userMap.get('admin@demo.eduflow.local');
  const demoTeacher = userMap.get('teacher@demo.eduflow.local');
  const demoStudent = userMap.get('student@demo.eduflow.local');
  const demoGuardian = userMap.get('guardian@demo.eduflow.local');

  // Link demo guardian to demo student
  await prisma.guardianLink.upsert({
    where: {
      guardianId_studentId: {
        guardianId: demoGuardian.id,
        studentId: demoStudent.id,
      },
    },
    update: {},
    create: {
      guardianId: demoGuardian.id,
      studentId: demoStudent.id,
    },
  });

  // 3. 12 Extra demo students with authentic Bangladeshi names
  const extraStudentProfiles = [
    { name: 'Tanvir Hasan', email: 'tanvir.hasan@demo.eduflow.local', phone: '01700010001', guardianName: 'Hasan Ali', guardianPhone: '01700020001' },
    { name: 'Nabila Tabassum', email: 'nabila.tabassum@demo.eduflow.local', phone: '01700010002', guardianName: 'Tabassum Morshed', guardianPhone: '01700020002' },
    { name: 'Shafiul Alam', email: 'shafiul.alam@demo.eduflow.local', phone: '01700010003', guardianName: 'Alamgir Hossain', guardianPhone: '01700020003' },
    { name: 'Sadia Afrin', email: 'sadia.afrin@demo.eduflow.local', phone: '01700010004', guardianName: 'Afrin Sultana', guardianPhone: '01700020004' },
    { name: 'Mehzabin Chowdhury', email: 'mehzabin.chowdhury@demo.eduflow.local', phone: '01700010005', guardianName: 'Chowdhury Kamal', guardianPhone: '01700020005' },
    { name: 'Rayhan Mahmud', email: 'rayhan.mahmud@demo.eduflow.local', phone: '01700010006', guardianName: 'Mahmudul Karim', guardianPhone: '01700020006' },
    { name: 'Tahmina Akter', email: 'tahmina.akter@demo.eduflow.local', phone: '01700010007', guardianName: 'Akteruzzaman Khan', guardianPhone: '01700020007' },
    { name: 'Farhan Ishrak', email: 'farhan.ishrak@demo.eduflow.local', phone: '01700010008', guardianName: 'Ishrak Ahmed', guardianPhone: '01700020008' },
    { name: 'Sabrina Sultana', email: 'sabrina.sultana@demo.eduflow.local', phone: '01700010009', guardianName: 'Sultan Mahmud', guardianPhone: '01700020009' },
    { name: 'Ashfaqur Rahman', email: 'ashfaqur.rahman@demo.eduflow.local', phone: '01700010010', guardianName: 'Motiur Rahman', guardianPhone: '01700020010' },
    { name: 'Sumaiya Parveen', email: 'sumaiya.parveen@demo.eduflow.local', phone: '01700010011', guardianName: 'Parveen Begum', guardianPhone: '01700020011' },
    { name: 'Kazi Zubair', email: 'kazi.zubair@demo.eduflow.local', phone: '01700010012', guardianName: 'Kazi Faruque', guardianPhone: '01700020012' },
  ];

  const allDemoStudents = [demoStudent];
  for (const s of extraStudentProfiles) {
    const hash = await makeRandomPasswordHash();
    const st = await prisma.user.upsert({
      where: { email: s.email },
      update: {
        name: s.name,
        role: Role.STUDENT,
        branchId: demoBranch.id,
        phone: s.phone,
        guardianName: s.guardianName,
        guardianPhone: s.guardianPhone,
      },
      create: {
        name: s.name,
        email: s.email,
        role: Role.STUDENT,
        branchId: demoBranch.id,
        phone: s.phone,
        guardianName: s.guardianName,
        guardianPhone: s.guardianPhone,
        password: hash,
      },
    });
    allDemoStudents.push(st);
  }

  // 4. Subjects
  let math = await prisma.subject.findFirst({ where: { name: 'Higher Mathematics' } });
  if (!math) math = await prisma.subject.create({ data: { name: 'Higher Mathematics' } });

  let physics = await prisma.subject.findFirst({ where: { name: 'Physics' } });
  if (!physics) physics = await prisma.subject.create({ data: { name: 'Physics' } });

  let chemistry = await prisma.subject.findFirst({ where: { name: 'Chemistry' } });
  if (!chemistry) chemistry = await prisma.subject.create({ data: { name: 'Chemistry' } });

  // 5. 3 Demo Batches (isPublished = false)
  const batchDefs = [
    {
      slug: 'demo-hsc-higher-math',
      name: 'Demo HSC 2026 Higher Math Intensive',
      type: BatchType.ACADEMIC,
      classLevel: 'HSC 2nd Year',
      feeType: FeeType.MONTHLY,
      feeAmount: 3500,
      subjectId: math.id,
      description: 'Internal demo batch for calculus, coordinate geometry, and board exam model tests.',
      routine: [
        { dayOfWeek: DayOfWeek.SUNDAY, startTime: '16:00', endTime: '17:30' },
        { dayOfWeek: DayOfWeek.TUESDAY, startTime: '16:00', endTime: '17:30' },
      ],
    },
    {
      slug: 'demo-hsc-physics',
      name: 'Demo HSC Physics Problem Solving & Labs',
      type: BatchType.ACADEMIC,
      classLevel: 'HSC 1st Year',
      feeType: FeeType.MONTHLY,
      feeAmount: 3500,
      subjectId: physics.id,
      description: 'Internal demo batch covering Newtonian mechanics, thermodynamics, and laboratory derivations.',
      routine: [
        { dayOfWeek: DayOfWeek.MONDAY, startTime: '17:30', endTime: '19:00' },
        { dayOfWeek: DayOfWeek.WEDNESDAY, startTime: '17:30', endTime: '19:00' },
      ],
    },
    {
      slug: 'demo-eng-chemistry',
      name: 'Demo Engineering Admission Chemistry Crash',
      type: BatchType.ADMISSION,
      classLevel: 'Admission',
      feeType: FeeType.ONE_TIME,
      feeAmount: 4500,
      subjectId: chemistry.id,
      description: 'Intensive practice on organic synthesis, chemical equilibrium, and BUET-format question banks.',
      routine: [
        { dayOfWeek: DayOfWeek.FRIDAY, startTime: '10:00', endTime: '12:00' },
        { dayOfWeek: DayOfWeek.SATURDAY, startTime: '10:00', endTime: '12:00' },
      ],
    },
  ];

  const batches = [];
  for (const b of batchDefs) {
    const batch = await prisma.batch.upsert({
      where: { slug: b.slug },
      update: {
        name: b.name,
        type: b.type,
        classLevel: b.classLevel,
        feeType: b.feeType,
        feeAmount: b.feeAmount,
        subjectId: b.subjectId,
        branchId: demoBranch.id,
        teacherId: demoTeacher.id,
        description: b.description,
        isPublished: false, // Strictly false: never on public explore page
      },
      create: {
        slug: b.slug,
        name: b.name,
        type: b.type,
        classLevel: b.classLevel,
        feeType: b.feeType,
        feeAmount: b.feeAmount,
        subjectId: b.subjectId,
        branchId: demoBranch.id,
        teacherId: demoTeacher.id,
        description: b.description,
        isPublished: false,
      },
    });
    batches.push(batch);

    // Routines
    await prisma.routineSlot.deleteMany({ where: { batchId: batch.id } });
    for (const r of b.routine) {
      await prisma.routineSlot.create({
        data: {
          batchId: batch.id,
          dayOfWeek: r.dayOfWeek,
          startTime: r.startTime,
          endTime: r.endTime,
        },
      });
    }
  }

  // 6. Enrollments: demo student enrolled in all 3; extra students distributed across them
  for (const b of batches) {
    // demoStudent always enrolled
    await prisma.enrollment.upsert({
      where: { studentId_batchId: { studentId: demoStudent.id, batchId: b.id } },
      update: { status: 'ACTIVE' },
      create: { studentId: demoStudent.id, batchId: b.id, status: 'ACTIVE' },
    });

    // Enroll 9-10 additional students per batch
    for (let i = 1; i < allDemoStudents.length; i++) {
      if (i % 3 === batches.indexOf(b) || i % 2 === 0) {
        const extraStudent = allDemoStudents[i];
        await prisma.enrollment.upsert({
          where: { studentId_batchId: { studentId: extraStudent.id, batchId: b.id } },
          update: { status: 'ACTIVE' },
          create: { studentId: extraStudent.id, batchId: b.id, status: 'ACTIVE' },
        });
      }
    }
  }

  // 7. 30 Days of Attendance
  const today = new Date();
  const enrolledBatches = await prisma.enrollment.findMany({
    where: { batch: { branchId: demoBranch.id } },
    select: { studentId: true, batchId: true },
  });

  for (let dayOffset = 30; dayOffset >= 1; dayOffset--) {
    const attendDate = new Date(today);
    attendDate.setDate(today.getDate() - dayOffset);
    attendDate.setHours(0, 0, 0, 0);

    // Skip Fridays for regular attendance simulation (Friday is weekend in BD)
    if (attendDate.getDay() === 5) continue;

    for (const enr of enrolledBatches) {
      const isPresent = (enr.studentId.charCodeAt(0) + dayOffset) % 10 !== 0;
      const status: AttendanceStatus = isPresent ? 'PRESENT' : ((dayOffset % 7 === 0) ? 'LATE' : 'ABSENT');

      await prisma.attendance.upsert({
        where: {
          studentId_batchId_date: {
            studentId: enr.studentId,
            batchId: enr.batchId,
            date: attendDate,
          },
        },
        update: { status, markedById: demoTeacher.id },
        create: {
          studentId: enr.studentId,
          batchId: enr.batchId,
          date: attendDate,
          status,
          markedById: demoTeacher.id,
        },
      });
    }
  }

  // 8. Fee Payments with mixed PAID, PARTIAL, DUE
  const periods = ['September 2026', 'October 2026'];
  for (const enr of enrolledBatches) {
    const batch = batches.find((b) => b.id === enr.batchId)!;
    for (const period of periods) {
      let status: PaymentStatus;
      let amountPaid: number;

      if (enr.studentId === demoStudent.id) {
        status = 'PAID';
        amountPaid = batch.feeAmount;
      } else {
        const hashVal = (enr.studentId.charCodeAt(enr.studentId.length - 1) + period.length) % 3;
        if (hashVal === 0) {
          status = 'PAID';
          amountPaid = batch.feeAmount;
        } else if (hashVal === 1) {
          status = 'PARTIAL';
          amountPaid = Math.floor(batch.feeAmount * 0.5);
        } else {
          status = 'DUE';
          amountPaid = 0;
        }
      }

      await prisma.feePayment.upsert({
        where: {
          studentId_batchId_period: {
            studentId: enr.studentId,
            batchId: enr.batchId,
            period,
          },
        },
        update: {
          amountDue: batch.feeAmount,
          amountPaid,
          status,
          recordedById: demoAdmin.id,
        },
        create: {
          studentId: enr.studentId,
          batchId: enr.batchId,
          period,
          amountDue: batch.feeAmount,
          amountPaid,
          status,
          dueDate: new Date(today.getFullYear(), today.getMonth(), 10),
          recordedById: demoAdmin.id,
        },
      });
    }
  }

  // 9. 3 Tests on Demo Batches
  // Test 1: Currently open (started 15 min ago, 60 min duration)
  const openTestDate = new Date(Date.now() - 15 * 60 * 1000);
  const test1 = await prisma.test.upsert({
    where: { id: 'demo-test-open-math' },
    update: {
      title: 'Demo Weekly Calculus Quiz (Active Window)',
      type: TestType.MCQ,
      batchId: batches[0].id,
      totalMarks: 20,
      negativeMarkingValue: 0.25,
      durationMinutes: 60,
      testDate: openTestDate,
      createdById: demoTeacher.id,
    },
    create: {
      id: 'demo-test-open-math',
      title: 'Demo Weekly Calculus Quiz (Active Window)',
      type: TestType.MCQ,
      batchId: batches[0].id,
      totalMarks: 20,
      negativeMarkingValue: 0.25,
      durationMinutes: 60,
      testDate: openTestDate,
      createdById: demoTeacher.id,
    },
  });

  // Questions for Test 1
  const existingQ1 = await prisma.question.findFirst({ where: { testId: test1.id } });
  if (!existingQ1) {
    await prisma.question.create({
      data: {
        testId: test1.id,
        type: QuestionType.MCQ,
        text: 'What is the derivative of f(x) = sin(2x) with respect to x?',
        marks: 10,
        order: 1,
        options: {
          create: [
            { text: '2 cos(2x)', isCorrect: true },
            { text: '-2 cos(2x)', isCorrect: false },
            { text: 'cos(2x)', isCorrect: false },
            { text: '2 sin(2x)', isCorrect: false },
          ],
        },
      },
    });
    await prisma.question.create({
      data: {
        testId: test1.id,
        type: QuestionType.MCQ,
        text: 'Evaluate limit as x approaches 0 of sin(x)/x:',
        marks: 10,
        order: 2,
        options: {
          create: [
            { text: '1', isCorrect: true },
            { text: '0', isCorrect: false },
            { text: 'Infinity', isCorrect: false },
            { text: 'Undefined', isCorrect: false },
          ],
        },
      },
    });
  }

  // Test 2: Past test (7 days ago) with results for students
  const pastTest2Date = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const test2 = await prisma.test.upsert({
    where: { id: 'demo-test-past-math-1' },
    update: {
      title: 'Demo Coordinate Geometry Monthly Assessment',
      type: TestType.MCQ,
      batchId: batches[0].id,
      totalMarks: 25,
      durationMinutes: 45,
      testDate: pastTest2Date,
      createdById: demoTeacher.id,
    },
    create: {
      id: 'demo-test-past-math-1',
      title: 'Demo Coordinate Geometry Monthly Assessment',
      type: TestType.MCQ,
      batchId: batches[0].id,
      totalMarks: 25,
      durationMinutes: 45,
      testDate: pastTest2Date,
      createdById: demoTeacher.id,
    },
  });

  // Test 3: Past test on Physics (14 days ago) with results
  const pastTest3Date = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const test3 = await prisma.test.upsert({
    where: { id: 'demo-test-past-physics' },
    update: {
      title: 'Demo Kinematics & Friction Chapter Test',
      type: TestType.MCQ,
      batchId: batches[1].id,
      totalMarks: 30,
      durationMinutes: 50,
      testDate: pastTest3Date,
      createdById: demoTeacher.id,
    },
    create: {
      id: 'demo-test-past-physics',
      title: 'Demo Kinematics & Friction Chapter Test',
      type: TestType.MCQ,
      batchId: batches[1].id,
      totalMarks: 30,
      durationMinutes: 50,
      testDate: pastTest3Date,
      createdById: demoTeacher.id,
    },
  });

  // Seed results for past tests
  const batch1Students = await prisma.enrollment.findMany({
    where: { batchId: batches[0].id },
    select: { studentId: true },
  });
  for (let idx = 0; idx < batch1Students.length; idx++) {
    const sId = batch1Students[idx].studentId;
    const score = sId === demoStudent.id ? 23.5 : Math.max(12, 25 - idx * 1.5);
    await prisma.result.upsert({
      where: { studentId_testId: { studentId: sId, testId: test2.id } },
      update: { totalMarksObtained: score, submittedAt: pastTest2Date, rank: idx + 1 },
      create: { studentId: sId, testId: test2.id, totalMarksObtained: score, submittedAt: pastTest2Date, rank: idx + 1 },
    });
  }

  const batch2Students = await prisma.enrollment.findMany({
    where: { batchId: batches[1].id },
    select: { studentId: true },
  });
  for (let idx = 0; idx < batch2Students.length; idx++) {
    const sId = batch2Students[idx].studentId;
    const score = sId === demoStudent.id ? 28.0 : Math.max(15, 30 - idx * 1.8);
    await prisma.result.upsert({
      where: { studentId_testId: { studentId: sId, testId: test3.id } },
      update: { totalMarksObtained: score, submittedAt: pastTest3Date, rank: idx + 1 },
      create: { studentId: sId, testId: test3.id, totalMarksObtained: score, submittedAt: pastTest3Date, rank: idx + 1 },
    });
  }

  // 10. Notices for Demo Branch
  const notices = [
    {
      title: 'Welcome to Term 2 Model Examinations - Banani Campus',
      content: 'All students are requested to arrive 15 minutes prior to test slots with admit cards and geometry boxes. Cell phones are strictly forbidden.',
    },
    {
      title: 'Special Offline Problem Solving Workshop This Friday',
      content: 'Teacher Dr. Anisur Rahman and Demo Faculty will host an open doubt clearing clinic at the Banani campus auditorium between 10:00 AM and 1:00 PM.',
    },
    {
      title: 'Autumn Academic Schedule & Monthly Fee Reminder',
      content: 'Tuition clearance for October 2026 must be completed before the 10th of the month. Parents can review invoices via their guardian portal login.',
    },
  ];

  for (const n of notices) {
    const existing = await prisma.notice.findFirst({
      where: { title: n.title, branchId: demoBranch.id },
    });
    if (!existing) {
      await prisma.notice.create({
        data: {
          title: n.title,
          content: n.content,
          branchId: demoBranch.id,
          createdById: demoAdmin.id,
        },
      });
    }
  }

  console.log('Demo branch data successfully populated:');
  console.log(`- Demo Branch: ${demoBranch.name}`);
  console.log(`- Batches: 3 (all unpublished)`);
  console.log(`- Students: ${allDemoStudents.length} (demo student + 12 extra)`);
  console.log(`- Attendance: 30 days history across all batches`);
  console.log(`- Payments: September & October records with PAID/PARTIAL/DUE`);
  console.log(`- Tests: 3 (1 currently open, 2 past with results)`);
  console.log(`- Notices: 3 campus announcements`);
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

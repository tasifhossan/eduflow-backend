import { PrismaClient, Role, BatchType, FeeType, TestType, QuestionType, DayOfWeek, AttendanceStatus, PaymentStatus, FeeChargeKind, PaymentMethod, FeeChargeSource, PaymentSource, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error(
      'REFUSING TO SEED: Demo content seeding is strictly forbidden in production and requires ALLOW_DEMO_SEED="true" in development.'
    );
  }

  console.log('================================================================');
  console.log(' WARNING: Seeding demo/sample content. Do NOT use on production!');
  console.log('================================================================');

  const collectedImageUrls: string[] = [];
  function trackImage(url: string | null | undefined): string {
    if (url && !collectedImageUrls.includes(url)) {
      collectedImageUrls.push(url);
    }
    return url || '';
  }

  // Passwords
  const adminPasswordPlain = process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(10).toString('hex');
  const teacherPasswordPlain = process.env.SEED_TEACHER_PASSWORD || crypto.randomBytes(10).toString('hex');
  const studentPasswordPlain = process.env.SEED_STUDENT_PASSWORD || crypto.randomBytes(10).toString('hex');

  const adminPasswordHash = await bcrypt.hash(adminPasswordPlain, 10);
  const teacherPasswordHash = await bcrypt.hash(teacherPasswordPlain, 10);
  const studentPasswordHash = await bcrypt.hash(studentPasswordPlain, 10);

  console.log('--- Seed Credentials ---');
  console.log(`Admin Password: ${adminPasswordPlain}`);
  console.log(`Teacher Password: ${teacherPasswordPlain}`);
  console.log(`Student Password: ${studentPasswordPlain}`);
  console.log('------------------------');

  // ==========================================
  // 1. Branches (3 branches)
  // ==========================================
  const branchesData = [
    { name: 'Dhanmondi Branch', address: 'House 14, Road 7, Dhanmondi R/A, Dhaka-1205' },
    { name: 'Uttara Branch', address: 'Plot 32, Sector 4, Road 18, Uttara Model Town, Dhaka-1230' },
    { name: 'Mirpur Branch', address: 'Plot 8, Block C, Main Road, Mirpur-10, Dhaka-1216' },
  ];

  const branches = [];
  for (const b of branchesData) {
    const branch = await prisma.branch.upsert({
      where: { id: `branch-${b.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}` },
      update: { name: b.name, address: b.address },
      create: { id: `branch-${b.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`, name: b.name, address: b.address },
    });
    branches.push(branch);
  }
  const mainBranch = branches[0];

  // Admin user
  await prisma.user.upsert({
    where: { email: 'admin@eduflow.com' },
    update: {
      name: 'Central Administrator',
      password: adminPasswordHash,
      role: Role.ADMIN,
      branchId: mainBranch.id,
      phone: '01711000001',
    },
    create: {
      name: 'Central Administrator',
      email: 'admin@eduflow.com',
      password: adminPasswordHash,
      role: Role.ADMIN,
      branchId: mainBranch.id,
      phone: '01711000001',
    },
  });

  // ==========================================
  // 2. Subjects (8 subjects) & Chapters
  // ==========================================
  const subjectsData = [
    { name: 'Physics', chapters: ['Vectors & Kinematics', 'Newtonian Mechanics', 'Work, Power & Energy', 'Gravitation & Gravity', 'Thermodynamics', 'Waves & Sound'] },
    { name: 'Chemistry', chapters: ['Qualitative Analysis', 'Periodic Table & Bonding', 'Chemical Equilibrium', 'Organic Chemistry Basics', 'Hydrocarbons', 'Electrochemistry'] },
    { name: 'Higher Mathematics', chapters: ['Matrices & Determinants', 'Straight Lines', 'Circles', 'Trigonometric Ratios', 'Differentiation & Calculus', 'Integration'] },
    { name: 'Biology', chapters: ['Cell Structure & Function', 'Cell Division', 'Plant Physiology', 'Human Physiology: Circulation', 'Genetics & Evolution', 'Biotechnology'] },
    { name: 'English', chapters: ['Advanced Right Form of Verbs', 'Sentence Connectors', 'Modifiers & Modifying Phrases', 'Reading Comprehension', 'Academic Composition'] },
    { name: 'ICT', chapters: ['Number Systems & Digital Logic', 'Web Design & HTML', 'C Programming Fundamentals', 'Database Management (DBMS)', 'Computer Networking'] },
    { name: 'Bangla', chapters: ['Bangla Sahitto Prose', 'Poetry Analysis', 'Grammar: Shondhi & Shomash', 'Composition & Essay Writing'] },
    { name: 'Accounting', chapters: ['Principles of Double Entry', 'Journal & Ledger Posting', 'Trial Balance Preparation', 'Financial Statements & Ratios'] },
  ];

  const subjects = [];
  const chaptersMap = new Map<string, any[]>();

  for (const s of subjectsData) {
    let subject = await prisma.subject.findFirst({
      where: { name: { equals: s.name, mode: 'insensitive' } },
    });
    if (!subject) {
      subject = await prisma.subject.create({ data: { name: s.name } });
    }
    subjects.push(subject);

    const createdChapters = [];
    for (const chName of s.chapters) {
      let chapter = await prisma.chapter.findFirst({
        where: { name: chName, subjectId: subject.id },
      });
      if (!chapter) {
        chapter = await prisma.chapter.create({
          data: { name: chName, subjectId: subject.id },
        });
      }
      createdChapters.push(chapter);
    }
    chaptersMap.set(subject.id, createdChapters);
  }

  // ==========================================
  // 3. Teachers (6 teachers with public profile)
  // ==========================================
  const teachersData = [
    {
      name: 'Dr. Anisur Rahman',
      email: 'anisur.rahman@eduflow.com',
      phone: '01711223301',
      branchId: branches[0].id,
      headline: 'Senior Physics Faculty | Ex-Notre Dame College & BUET',
      bio: 'Specialist in HSC and Engineering Physics with over 15 years of classroom mentoring experience. Guided 2,000+ students into top engineering universities across Bangladesh.',
      avatarUrl: trackImage('https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80'),
    },
    {
      name: 'Farhana Yasmin',
      email: 'farhana.yasmin@eduflow.com',
      phone: '01711223302',
      branchId: branches[0].id,
      headline: 'Lead Chemistry Mentor | M.Sc. University of Dhaka',
      bio: 'Passionate chemistry educator focusing on organic reaction mechanisms, stoichiometry, and medical entrance examination patterns with visual memorization frameworks.',
      avatarUrl: trackImage('https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=400&q=80'),
    },
    {
      name: 'Tanvir Ahmed Chowdhury',
      email: 'tanvir.chowdhury@eduflow.com',
      phone: '01711223303',
      branchId: branches[1].id,
      headline: 'Higher Mathematics Specialist | Dept of Mathematics, DU',
      bio: 'Author of advanced calculus problem sets with 11 years of coaching students for HSC board distinction and university admission tests.',
      avatarUrl: trackImage('https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80'),
    },
    {
      name: 'Dr. Nusrat Jahan',
      email: 'nusrat.jahan@eduflow.com',
      phone: '01711223304',
      branchId: branches[1].id,
      headline: 'Medical Admission Biology Mentor | MBBS, Dhaka Medical College',
      bio: 'Specializes in human physiology, genetics, and plant anatomy. Equips pre-medical aspirants with rapid memory mnemonics and diagram techniques for medical admission tests.',
      avatarUrl: trackImage('https://images.unsplash.com/photo-1594824813590-789a5b12cca2?auto=format&fit=crop&w=400&q=80'),
    },
    {
      name: 'Kazi Mashiur Rahman',
      email: 'mashiur.rahman@eduflow.com',
      phone: '01711223305',
      branchId: branches[2].id,
      headline: 'ICT & Computing Educator | B.Sc. CSE, BUET',
      bio: 'Simplifies Boolean algebra, C programming, HTML, and networking for HSC candidates and national informatics olympiad competitors.',
      avatarUrl: trackImage('https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80'),
    },
    {
      name: 'Syeda Mahfuza Khatun',
      email: 'mahfuza.khatun@eduflow.com',
      phone: '01711223306',
      branchId: branches[2].id,
      headline: 'Senior English Lecturer | MA in English Language Teaching, DU',
      bio: 'Master trainer in grammar, academic essay composition, and comprehension strategies with over a decade of dedicated teaching experience.',
      avatarUrl: trackImage('https://images.unsplash.com/photo-1580894732444-8ecded7900cd?auto=format&fit=crop&w=400&q=80'),
    },
  ];

  const teachers = [];
  for (const t of teachersData) {
    const teacher = await prisma.user.upsert({
      where: { email: t.email },
      update: {
        name: t.name,
        phone: t.phone,
        password: teacherPasswordHash,
        role: Role.TEACHER,
        branchId: t.branchId,
        headline: t.headline,
        bio: t.bio,
        avatarUrl: t.avatarUrl,
        isPublicProfile: true,
      },
      create: {
        name: t.name,
        email: t.email,
        phone: t.phone,
        password: teacherPasswordHash,
        role: Role.TEACHER,
        branchId: t.branchId,
        headline: t.headline,
        bio: t.bio,
        avatarUrl: t.avatarUrl,
        isPublicProfile: true,
      },
    });
    teachers.push(teacher);
  }

  // ==========================================
  // 4. Batches (12 Published Batches)
  // ==========================================
  const batchesSeedData = [
    {
      name: 'HSC 2026 Physics Comprehensive',
      slug: 'hsc-2026-physics-comprehensive',
      type: BatchType.ACADEMIC,
      classLevel: 'HSC 1st Year',
      feeType: FeeType.MONTHLY,
      feeAmount: 4000.0,
      subjectId: subjects[0].id, // Physics
      branchId: branches[0].id,
      teacherId: teachers[0].id,
      imageUrl: trackImage('https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa?auto=format&fit=crop&w=800&q=80'),
      gallery: [
        trackImage('https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=800&q=80'),
        trackImage('https://images.unsplash.com/photo-1532094349884-543bc11b234d?auto=format&fit=crop&w=800&q=80'),
      ],
      description: 'Master first-year physics fundamentals with rigorous mathematical derivations, real-world experiments, and weekly analytical problem sets structured for both Board exams and competitive university admissions.',
      highlights: ['48 Lectures covering Vector, Dynamics & Wave Theory', 'Weekly MCQ & Creative Written Model Exams', 'Complete Lecture Sheets & Board Question Banks', 'Dedicated Offline Doubt-Solving Sessions'],
      syllabus: {
        modules: [
          { title: 'Vector Analysis and Scalars', duration: '3 Weeks', topics: ['Dot & Cross Products', 'River-Boat Problems', 'Unit Vectors'] },
          { title: 'Newtonian Dynamics', duration: '4 Weeks', topics: ['Friction & Banking', 'Momentum Conservation', 'Torque & Angular Motion'] },
          { title: 'Work, Energy & Power', duration: '3 Weeks', topics: ['Conservative Forces', 'Potential Energy Curves', 'Power Calculations'] },
        ],
      },
    },
    {
      name: 'Engineering Admission Math Intensive 2025',
      slug: 'engineering-admission-math-intensive-2025',
      type: BatchType.ADMISSION,
      classLevel: 'HSC Examinee / Admission',
      feeType: FeeType.ONE_TIME,
      feeAmount: 8500.0,
      subjectId: subjects[2].id, // Math
      branchId: branches[0].id,
      teacherId: teachers[2].id,
      imageUrl: trackImage('https://images.unsplash.com/photo-1509228468518-180dd4864904?auto=format&fit=crop&w=800&q=80'),
      gallery: [
        trackImage('https://images.unsplash.com/photo-1596495578065-6e0763fa1178?auto=format&fit=crop&w=800&q=80'),
        trackImage('https://images.unsplash.com/photo-1635070041078-e363dbe005cb?auto=format&fit=crop&w=800&q=80'),
      ],
      description: 'An aggressive problem-solving program tailored specifically for BUET, CKET, and top engineering entrance assessments. Emphasizes rapid shortcut techniques alongside fundamental proof accuracy.',
      highlights: ['Over 1,200 curated BUET-standard problems solved in class', 'OMR-based negative-marking mock tests every Saturday', 'Calculus, Vectors, and Conics speed-drilling workshops', 'Personalized rank cards and performance tracking'],
      syllabus: {
        modules: [
          { title: 'Advanced Calculus & Curve Sketching', duration: '4 Weeks', topics: ['Leibniz Theorem', 'Definite Integrals as Limits', 'Maxima & Minima Application'] },
          { title: 'Coordinate Geometry & Conic Sections', duration: '3 Weeks', topics: ['Parabola, Ellipse & Hyperbola Eccentricity', 'Tangents & Normals'] },
          { title: 'Trigonometry & Complex Numbers', duration: '3 Weeks', topics: ['Euler Form', 'De Moivre Formula', 'Inverse Circular Functions'] },
        ],
      },
    },
    {
      name: 'HSC Organic Chemistry Masterclass',
      slug: 'hsc-organic-chemistry-masterclass',
      type: BatchType.ACADEMIC,
      classLevel: 'HSC 2nd Year',
      feeType: FeeType.MONTHLY,
      feeAmount: 3800.0,
      subjectId: subjects[1].id, // Chemistry
      branchId: branches[0].id,
      teacherId: teachers[1].id,
      imageUrl: trackImage('https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?auto=format&fit=crop&w=800&q=80'),
      gallery: [
        trackImage('https://images.unsplash.com/photo-1603126857599-f6e157fa2fe6?auto=format&fit=crop&w=800&q=80'),
      ],
      description: 'Demystify Organic Chemistry Chapter 2 with intuitive reaction flowcharts, electrophilic/nucleophilic reaction mechanisms, naming conventions, and conversions.',
      highlights: ['Reaction flowchart sheets memorization blueprint', 'Every conversion from past 15 years board papers solved', 'Laboratory qualitative test identification guide', 'Weekly review quizzes with instant feedback'],
      syllabus: {
        modules: [
          { title: 'Alkanes, Alkenes & Alkynes', duration: '3 Weeks', topics: ['Markovnikov Rule', 'Peroxide Effect', 'Ozonolysis Reactions'] },
          { title: 'Aromatic Compounds', duration: '3 Weeks', topics: ['Benzene Structure & Resonance', 'Friedel-Crafts Reactions', 'Orientation Effects'] },
          { title: 'Alcohols, Aldehydes & Ketones', duration: '4 Weeks', topics: ['Cannizzaro & Aldol Condensation', 'Lucas Test', 'Grignard Reagent Synthetic Utilities'] },
        ],
      },
    },
    {
      name: 'Medical Admission Biology Excellence 2026',
      slug: 'medical-admission-biology-excellence-2026',
      type: BatchType.ADMISSION,
      classLevel: 'HSC 2nd Year / Admission',
      feeType: FeeType.ONE_TIME,
      feeAmount: 8000.0,
      subjectId: subjects[3].id, // Biology
      branchId: branches[1].id,
      teacherId: teachers[3].id,
      imageUrl: trackImage('https://images.unsplash.com/photo-1530497610245-94d3c16cda28?auto=format&fit=crop&w=800&q=80'),
      gallery: [
        trackImage('https://images.unsplash.com/photo-1576086213369-97a306d36557?auto=format&fit=crop&w=800&q=80'),
      ],
      description: 'A comprehensive pre-medical biology preparation course designed by doctor-educators. Line-by-line textbook retention, mnemonics, and extensive model test series matching DGHS standards.',
      highlights: ['Line-by-line coverage of Gazi Ajmol and Abul Hasan textbooks', '100-mark OMR model tests matching DGHS medical entrance standards', 'Daily rapid-fire quiz on anatomical and genetic terminology', 'Exclusive medical admission booster handbook'],
      syllabus: {
        modules: [
          { title: 'Human Physiology & Organ Systems', duration: '5 Weeks', topics: ['Blood & Circulation', 'Respiratory Mechanics', 'Excretion & Osmoregulation'] },
          { title: 'Genetics, Evolution & Molecular Biology', duration: '3 Weeks', topics: ['Mendelian Ratios', 'DNA Replication & Transcription', 'Genetic Disorders'] },
          { title: 'Plant Physiology & Diversity', duration: '4 Weeks', topics: ['Photosynthesis C3/C4', 'Gymnosperms & Angiosperms', 'Plant Tissue Systems'] },
        ],
      },
    },
    {
      name: 'HSC ICT Fast-Track Crash Course',
      slug: 'hsc-ict-fast-track-crash-course',
      type: BatchType.ACADEMIC,
      classLevel: 'HSC 1st & 2nd Year',
      feeType: FeeType.ONE_TIME,
      feeAmount: 4500.0,
      subjectId: subjects[5].id, // ICT
      branchId: branches[1].id,
      teacherId: teachers[4].id,
      imageUrl: trackImage('https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=800&q=80'),
      gallery: [
        trackImage('https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=800&q=80'),
      ],
      description: 'Clear the entire HSC ICT syllabus in 8 weeks with hands-on HTML tag building, C programming live coding sessions, logic circuit design, and database queries.',
      highlights: ['Live coding sessions for C Programming with GCC', 'Interactive digital logic simulator practice in class', 'Full coverage of past 5 years Board CQ questions', 'Free digital copy of EduFlow ICT Companion Guide'],
      syllabus: {
        modules: [
          { title: 'Number Systems & Boolean Algebra', duration: '2 Weeks', topics: ['2s Complement Operations', 'Logic Gate Simplification', 'Karnaugh Maps'] },
          { title: 'Web Development & HTML Basics', duration: '2 Weeks', topics: ['Semantic HTML5 Tags', 'Table Structuring', 'Hyperlink Anchors'] },
          { title: 'C Programming for HSC', duration: '4 Weeks', topics: ['Conditionals & Loops', 'Array Operations', 'User Defined Functions'] },
        ],
      },
    },
    {
      name: 'Academic English Grammar & Writing Core',
      slug: 'academic-english-grammar-writing-core',
      type: BatchType.ACADEMIC,
      classLevel: 'HSC 1st Year',
      feeType: FeeType.MONTHLY,
      feeAmount: 3500.0,
      subjectId: subjects[4].id, // English
      branchId: branches[1].id,
      teacherId: teachers[5].id,
      imageUrl: trackImage('https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=800&q=80'),
      gallery: [
        trackImage('https://images.unsplash.com/photo-1457369804613-52c61a468e7d?auto=format&fit=crop&w=800&q=80'),
      ],
      description: 'Eliminate grammar errors and elevate composition quality. Master modifiers, sentence connectors, punctuation, and thematic précis writing for Golden A+.',
      highlights: ['Weekly checked essays with detailed individual feedback', 'Zero-tolerance grammar drills on modifiers and connectors', 'Vocabulary expansion focusing on formal academic diction', 'Previous Board Question solution clinics'],
      syllabus: {
        modules: [
          { title: 'Grammar Precision Mastery', duration: '4 Weeks', topics: ['Preposition Collocations', 'Subject-Verb Agreement', 'Sentence Completing Rules'] },
          { title: 'Advanced Modifiers & Connectors', duration: '3 Weeks', topics: ['Pre-modifiers & Post-modifiers', 'Logical Cohesion Markers', 'Punctuation Conventions'] },
          { title: 'Creative Academic Composition', duration: '3 Weeks', topics: ['Argumentative Paragraphs', 'Formal Letter & Email Drafting', 'Graph Interpretation'] },
        ],
      },
    },
    {
      name: 'Class 10 SSC Higher Math Foundation',
      slug: 'class-10-ssc-higher-math-foundation',
      type: BatchType.ACADEMIC,
      classLevel: 'Class 10 (SSC)',
      feeType: FeeType.MONTHLY,
      feeAmount: 3500.0,
      subjectId: subjects[2].id, // Math
      branchId: branches[2].id,
      teacherId: teachers[2].id,
      imageUrl: trackImage('https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=800&q=80'),
      gallery: [
        trackImage('https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=800&q=80'),
      ],
      description: 'Strengthen high-school algebra, geometry theorems, vectors, and coordinate geometry for students targeting GPA 5.00 in the upcoming SSC board examinations.',
      highlights: ['Complete NCTB textbook problem coverage with alternate methods', 'Special focus on Chapter 14 Probability and Chapter 11 Coordinate Geometry', 'Bi-weekly chapter tests with detailed solution sheets', 'Small batch size ensuring personalized student attention'],
      syllabus: {
        modules: [
          { title: 'Algebra & Exponential Equations', duration: '3 Weeks', topics: ['Set Theory & Functions', 'Logarithmic Equations', 'Partial Fractions'] },
          { title: 'Geometric Proofs & Solid Geometry', duration: '4 Weeks', topics: ['Apollonius Theorem', 'Pyramids and Cones', 'Vector Geometry Proofs'] },
          { title: 'Trigonometry & Probability', duration: '3 Weeks', topics: ['Radian Measurement', 'Trigonometric Identities', 'Probability Tree Diagrams'] },
        ],
      },
    },
    {
      name: 'Class 10 SSC Integrated Physics & Chemistry',
      slug: 'class-10-ssc-integrated-physics-chemistry',
      type: BatchType.ACADEMIC,
      classLevel: 'Class 10 (SSC)',
      feeType: FeeType.MONTHLY,
      feeAmount: 4200.0,
      subjectId: subjects[0].id, // Physics
      branchId: branches[2].id,
      teacherId: teachers[0].id,
      imageUrl: trackImage('https://images.unsplash.com/photo-1532094349884-543bc11b234d?auto=format&fit=crop&w=800&q=80'),
      gallery: [
        trackImage('https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=800&q=80'),
      ],
      description: 'Dual-subject intensive coaching for SSC science students. Blends physics mechanics and optical rays with chemistry chemical bonding and mole concept calculations.',
      highlights: ['Joint syllabus schedule covering Physics & Chemistry in tandem', 'Experimental demonstration videos for complex reaction concepts', 'Formula flashcards and equation balancing practice drills', 'Full length test papers modeled on Dhaka and Rajshahi Board exams'],
      syllabus: {
        modules: [
          { title: 'Physics: Motion & Force', duration: '4 Weeks', topics: ['Kinematic Equations', 'Newtons Laws & Inertia', 'Gravitational Acceleration'] },
          { title: 'Chemistry: Structure of Atom & Periodic Table', duration: '4 Weeks', topics: ['Bohr Atomic Model', 'Electron Configuration', 'Periodic Trends in Properties'] },
          { title: 'Physics: Light Reflection & Refraction', duration: '3 Weeks', topics: ['Spherical Mirrors', 'Refractive Index', 'Lens Formula & Magnification'] },
        ],
      },
    },
    {
      name: 'BUET Engineering Admission Physics Intensive',
      slug: 'buet-engineering-admission-physics-intensive',
      type: BatchType.ADMISSION,
      classLevel: 'Admission 2025',
      feeType: FeeType.ONE_TIME,
      feeAmount: 9000.0,
      subjectId: subjects[0].id, // Physics
      branchId: branches[0].id,
      teacherId: teachers[0].id,
      imageUrl: trackImage('https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=800&q=80'),
      gallery: [
        trackImage('https://images.unsplash.com/photo-1507413245164-6160d8298b31?auto=format&fit=crop&w=800&q=80'),
      ],
      description: 'The premier physics training ground for aspiring BUET candidates. High-level problem sets adapted from Irodov, Krotov, and past 25 years BUET question archives.',
      highlights: ['Deep analytical mechanics and electromagnetism problem sets', 'Daily 10-problem speed challenge sessions', 'Weekly ranked offline mock exams with negative scoring', 'Mentorship directly from senior BUET graduates'],
      syllabus: {
        modules: [
          { title: 'Advanced Rigid Body Mechanics', duration: '4 Weeks', topics: ['Moment of Inertia of Complex Geometries', 'Rolling Without Slipping', 'Collision in 2D'] },
          { title: 'Electromagnetism & Circuits', duration: '4 Weeks', topics: ['Kirchhoff Laws with Capacitors', 'Biot-Savart Law', 'LCR AC Circuits'] },
          { title: 'Modern Physics & Optics', duration: '3 Weeks', topics: ['Photoelectric Effect', 'Wave Optics & Double Slit Interference', 'Radioactive Decay Laws'] },
        ],
      },
    },
    {
      name: 'Medical Admission Chemistry Sprint 2026',
      slug: 'medical-admission-chemistry-sprint-2026',
      type: BatchType.ADMISSION,
      classLevel: 'Admission 2026',
      feeType: FeeType.ONE_TIME,
      feeAmount: 7500.0,
      subjectId: subjects[1].id, // Chemistry
      branchId: branches[1].id,
      teacherId: teachers[1].id,
      imageUrl: trackImage('https://images.unsplash.com/photo-1563170351-be82bc888aa4?auto=format&fit=crop&w=800&q=80'),
      gallery: [
        trackImage('https://images.unsplash.com/photo-1518152006812-edab29b069ac?auto=format&fit=crop&w=800&q=80'),
      ],
      description: 'Rapid-retention chemistry sprint targeted at medical candidates. Emphasizes chemical arithmetic, acid-base equilibrium calculations, and organic conversion shortcuts.',
      highlights: ['High-yield fact sheets covering Hazard symbols and Environmental Chemistry', 'Timed 25-question sprints replicating Medical Admission speed', 'Acid-Base buffer calculation shortcuts without scientific calculator', 'Special revision sessions for tricky qualitative inorganic tests'],
      syllabus: {
        modules: [
          { title: 'Chemical Calculations & Solutions', duration: '3 Weeks', topics: ['Molarity, Molality & Normality', 'Beer-Lambert Law', 'Titration Curves'] },
          { title: 'Chemical Equilibrium & pH', duration: '3 Weeks', topics: ['Buffer Action & Henderson Equation', 'Le Chatelier Principle', 'Solubility Product (Ksp)'] },
          { title: 'Environmental & Industrial Chemistry', duration: '3 Weeks', topics: ['BOD & COD Measurement', 'Ozone Layer Depletion', 'Urea & Glass Manufacturing'] },
        ],
      },
    },
    {
      name: 'HSC 2025 Final Revision & Model Test Batch',
      slug: 'hsc-2025-final-revision-model-test-batch',
      type: BatchType.ACADEMIC,
      classLevel: 'HSC 2nd Year',
      feeType: FeeType.ONE_TIME,
      feeAmount: 5000.0,
      subjectId: subjects[0].id, // Physics
      branchId: branches[2].id,
      teacherId: teachers[0].id,
      imageUrl: trackImage('https://images.unsplash.com/photo-1427504494785-3a9ca7044f45?auto=format&fit=crop&w=800&q=80'),
      gallery: [
        trackImage('https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=800&q=80'),
      ],
      description: 'Full syllabus rehearsal under strict board exam conditions. Includes 10 complete paper simulations with line-by-line mark breakdown and script evaluation.',
      highlights: ['10 full-length simulated Board exams with personalized script grading', 'Quick-reference revision booklets for high-frequency formulas', 'Common error analysis workshops to eliminate careless calculation mistakes', 'One-on-one script review with senior examiners'],
      syllabus: {
        modules: [
          { title: 'Paper I Full Syllabus Test Series', duration: '3 Weeks', topics: ['Mechanics & Heat Simulation', 'Optics & Wave Simulation', 'Comprehensive Paper 1 Evaluation'] },
          { title: 'Paper II Full Syllabus Test Series', duration: '3 Weeks', topics: ['Electricity & Magnetism Simulation', 'Modern Physics Simulation', 'Comprehensive Paper 2 Evaluation'] },
        ],
      },
    },
    {
      name: 'Class 9 Foundation Science & Math',
      slug: 'class-9-foundation-science-math',
      type: BatchType.ACADEMIC,
      classLevel: 'Class 9',
      feeType: FeeType.MONTHLY,
      feeAmount: 3200.0,
      subjectId: subjects[2].id, // Math
      branchId: branches[0].id,
      teacherId: teachers[2].id,
      imageUrl: trackImage('https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=800&q=80'),
      gallery: [
        trackImage('https://images.unsplash.com/photo-1497633762265-9d179a990aa6?auto=format&fit=crop&w=800&q=80'),
      ],
      description: 'Early-stage conceptual grooming for Class 9 students entering the Science division. Sets an unshakable base in algebraic equations and basic physical quantities.',
      highlights: ['Step-by-step guidance transitioning from Junior to Secondary Science', 'Interactive math visualizations to build geometric intuition', 'Fortnightly parent-teacher review calls on academic progress', 'Structured daily homework check system'],
      syllabus: {
        modules: [
          { title: 'Real Numbers & Algebraic Expressions', duration: '4 Weeks', topics: ['Rational vs Irrational Numbers', 'Polynomial Factorization', 'Linear Equations in Two Variables'] },
          { title: 'Physical Quantities & Kinematic Graphs', duration: '3 Weeks', topics: ['SI Units & Dimensions', 'Velocity-Time Graph Interpretation', 'Uniform Acceleration'] },
        ],
      },
    },
  ];

  const batches = [];
  for (const b of batchesSeedData) {
    const batch = await prisma.batch.upsert({
      where: { slug: b.slug },
      update: {
        name: b.name,
        type: b.type,
        classLevel: b.classLevel,
        feeType: b.feeType,
        feeAmount: b.feeAmount,
        subjectId: b.subjectId,
        branchId: b.branchId,
        teacherId: b.teacherId,
        imageUrl: b.imageUrl,
        gallery: b.gallery,
        description: b.description,
        highlights: b.highlights,
        syllabus: b.syllabus,
        isPublished: true,
      },
      create: {
        slug: b.slug,
        name: b.name,
        type: b.type,
        classLevel: b.classLevel,
        feeType: b.feeType,
        feeAmount: b.feeAmount,
        subjectId: b.subjectId,
        branchId: b.branchId,
        teacherId: b.teacherId,
        imageUrl: b.imageUrl,
        gallery: b.gallery,
        description: b.description,
        highlights: b.highlights,
        syllabus: b.syllabus,
        isPublished: true,
      },
    });
    batches.push(batch);
  }

  // ==========================================
  // 5. Students (40 students with realistic details)
  // ==========================================
  const studentNames = [
    { name: 'Arif Hossain', phone: '01711001001', guardianName: 'Md. Delwar Hossain', guardianPhone: '01711002001' },
    { name: 'Tasmia Rahman', phone: '01711001002', guardianName: 'Abdur Rahman Khan', guardianPhone: '01711002002' },
    { name: 'Fahim Shahriar', phone: '01711001003', guardianName: 'Shahriar Kabir', guardianPhone: '01711002003' },
    { name: 'Sumaiya Akter', phone: '01711001004', guardianName: 'Golam Mostafa', guardianPhone: '01711002004' },
    { name: 'Mehedi Hasan', phone: '01711001005', guardianName: 'Anwarul Haque', guardianPhone: '01711002005' },
    { name: 'Nafisa Anjum', phone: '01711001006', guardianName: 'Dr. Mokhlesur Rahman', guardianPhone: '01711002006' },
    { name: 'Sabbir Ahmed', phone: '01711001007', guardianName: 'Jahangir Alam', guardianPhone: '01711002007' },
    { name: 'Israt Jahan', phone: '01711001008', guardianName: 'Zahirul Islam', guardianPhone: '01711002008' },
    { name: 'Rifat Karim', phone: '01711001009', guardianName: 'Rezaul Karim', guardianPhone: '01711002009' },
    { name: 'Sadia Islam', phone: '01711001010', guardianName: 'Nazrul Islam', guardianPhone: '01711002010' },
    { name: 'Zubair Al Mahmud', phone: '01711001011', guardianName: 'Mahmudul Hasan', guardianPhone: '01711002011' },
    { name: 'Tabassum Noor', phone: '01711001012', guardianName: 'Nurul Huda', guardianPhone: '01711002012' },
    { name: 'Shakil Chowdhury', phone: '01711001013', guardianName: 'Masud Chowdhury', guardianPhone: '01711002013' },
    { name: 'Mahira Khan', phone: '01711001014', guardianName: 'Faruk Khan', guardianPhone: '01711002014' },
    { name: 'Raihan Kabir', phone: '01711001015', guardianName: 'Kabir Ahmed', guardianPhone: '01711002015' },
    { name: 'Munira Sultana', phone: '01711001016', guardianName: 'Sultan Mahmud', guardianPhone: '01711002016' },
    { name: 'Tanzeem Haque', phone: '01711001017', guardianName: 'Enamul Haque', guardianPhone: '01711002017' },
    { name: 'Samira Nawar', phone: '01711001018', guardianName: 'Quazi Nawarul Islam', guardianPhone: '01711002018' },
    { name: 'Mustafa Kamal', phone: '01711001019', guardianName: 'Kamal Pasha', guardianPhone: '01711002019' },
    { name: 'Fatima Tuz Zohra', phone: '01711001020', guardianName: 'Aminul Islam', guardianPhone: '01711002020' },
    { name: 'Adnan Sami', phone: '01711001021', guardianName: 'Samiul Haque', guardianPhone: '01711002021' },
    { name: 'Lamia Tabassum', phone: '01711001022', guardianName: 'Rafiqul Islam', guardianPhone: '01711002022' },
    { name: 'Shahriar Niloy', phone: '01711001023', guardianName: 'Sirajul Islam', guardianPhone: '01711002023' },
    { name: 'Anika Bushra', phone: '01711001024', guardianName: 'Bushra Khan', guardianPhone: '01711002024' },
    { name: 'Kamrul Hasan', phone: '01711001025', guardianName: 'Hasanuzzaman', guardianPhone: '01711002025' },
    { name: 'Fariha Tasnim', phone: '01711001026', guardianName: 'Tasnim Ahmed', guardianPhone: '01711002026' },
    { name: 'Ahsan Habib', phone: '01711001027', guardianName: 'Habibur Rahman', guardianPhone: '01711002027' },
    { name: 'Bushra Rahman', phone: '01711001028', guardianName: 'Matiur Rahman', guardianPhone: '01711002028' },
    { name: 'Tamjid Ahmed', phone: '01711001029', guardianName: 'Shafiq Ahmed', guardianPhone: '01711002029' },
    { name: 'Nowshin Sharmili', phone: '01711001030', guardianName: 'Sharmil Haque', guardianPhone: '01711002030' },
    { name: 'Wasif Zaman', phone: '01711001031', guardianName: 'Dr. Asaduzzaman', guardianPhone: '01711002031' },
    { name: 'Tasnim Jahan', phone: '01711001032', guardianName: 'Jahangir Hossain', guardianPhone: '01711002032' },
    { name: 'Salman Farsi', phone: '01711001033', guardianName: 'Faruque Farsi', guardianPhone: '01711002033' },
    { name: 'Nusrat Sharmin', phone: '01711001034', guardianName: 'Sharmin Akhter', guardianPhone: '01711002034' },
    { name: 'Emon Talukder', phone: '01711001035', guardianName: 'Talukder Siraj', guardianPhone: '01711002035' },
    { name: 'Subrata Roy', phone: '01711001036', guardianName: 'Shyamal Roy', guardianPhone: '01711002036' },
    { name: 'Pooja Das', phone: '01711001037', guardianName: 'Prabir Das', guardianPhone: '01711002037' },
    { name: 'Animesh Sen', phone: '01711001038', guardianName: 'Ashoke Sen', guardianPhone: '01711002038' },
    { name: 'Joyanta Paul', phone: '01711001039', guardianName: 'Bikash Paul', guardianPhone: '01711002039' },
    { name: 'Bidhan Chandra', phone: '01711001040', guardianName: 'Chandra Shekar', guardianPhone: '01711002040' },
  ];

  const students = [];
  for (let i = 0; i < studentNames.length; i++) {
    const s = studentNames[i];
    const email = `student${i + 1}@eduflow.com`;
    const branchId = branches[i % branches.length].id;

    const student = await prisma.user.upsert({
      where: { email },
      update: {
        name: s.name,
        phone: s.phone,
        password: studentPasswordHash,
        role: Role.STUDENT,
        branchId,
        guardianName: s.guardianName,
        guardianPhone: s.guardianPhone,
      },
      create: {
        name: s.name,
        email,
        phone: s.phone,
        password: studentPasswordHash,
        role: Role.STUDENT,
        branchId,
        guardianName: s.guardianName,
        guardianPhone: s.guardianPhone,
      },
    });
    students.push(student);
  }

  // ==========================================
  // 6. Enrollments, Routines, Attendance & Fees
  // ==========================================
  console.log('Seeding enrollments, routines, and attendance...');

  const enrollmentRecords = [];
  const feePaymentRecords = [];
  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    const primaryBatch = batches[i % batches.length];
    const secondaryBatch = batches[(i + 3) % batches.length];

    for (const b of [primaryBatch, secondaryBatch]) {
      enrollmentRecords.push({
        studentId: student.id,
        batchId: b.id,
        status: 'ACTIVE' as const,
        customFeeAmount: b.feeAmount,
      });
    }
  }

  await prisma.enrollment.createMany({ data: enrollmentRecords, skipDuplicates: true });

  const createdEnrollments = await prisma.enrollment.findMany({
    include: { batch: true },
  });

  for (let i = 0; i < createdEnrollments.length; i++) {
    const enr = createdEnrollments[i];
    const b = enr.batch;
    const period = '2026-10';

    const existingCharge = await prisma.feeCharge.findFirst({
      where: { enrollmentId: enr.id, kind: FeeChargeKind.TUITION, period, voidedAt: null },
    });

    if (!existingCharge) {
      const charge = await prisma.feeCharge.create({
        data: {
          studentId: enr.studentId,
          batchId: b.id,
          branchId: b.branchId,
          enrollmentId: enr.id,
          description: `${b.name} - Tuition (${period})`,
          kind: FeeChargeKind.TUITION,
          period,
          amount: b.feeAmount,
          dueDate: new Date('2026-10-15'),
          source: FeeChargeSource.GENERATED,
          createdById: teachers[0].id,
        },
      });

      if (i % 3 === 0) {
        const payAmount = b.feeAmount;
        const receiptNo = `DHAN-26-${String(1000 + i).padStart(6, '0')}`;
        await prisma.payment.create({
          data: {
            studentId: enr.studentId,
            branchId: b.branchId,
            receivedById: teachers[0].id,
            receiptNumber: receiptNo,
            amount: payAmount,
            method: PaymentMethod.BKASH,
            reference: `TRX${100000 + i}`,
            receivedAt: new Date('2026-10-10'),
            note: 'Full monthly payment via bKash',
            source: PaymentSource.MANUAL,
            allocations: {
              create: {
                branchId: b.branchId,
                chargeId: charge.id,
                amount: payAmount,
              },
            },
          },
        });
      } else if (i % 3 === 1) {
        const halfAmount = Number(b.feeAmount) / 2;
        const payAmount = new Prisma.Decimal(halfAmount.toFixed(2));
        const receiptNo = `DHAN-26-${String(2000 + i).padStart(6, '0')}`;
        await prisma.payment.create({
          data: {
            studentId: enr.studentId,
            branchId: b.branchId,
            receivedById: teachers[0].id,
            receiptNumber: receiptNo,
            amount: payAmount,
            method: PaymentMethod.CASH,
            receivedAt: new Date('2026-10-12'),
            note: 'Partial advance paid',
            source: PaymentSource.MANUAL,
            allocations: {
              create: {
                branchId: b.branchId,
                chargeId: charge.id,
                amount: payAmount,
              },
            },
          },
        });
      }
    }
  }

  // Routine Slots
  const days: DayOfWeek[] = [DayOfWeek.SUNDAY, DayOfWeek.TUESDAY, DayOfWeek.THURSDAY, DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY, DayOfWeek.SATURDAY];
  for (let i = 0; i < batches.length; i++) {
    const b = batches[i];
    const day1 = days[i % 3];
    const day2 = days[(i % 3) + 3];

    const existingSlots = await prisma.routineSlot.findMany({ where: { batchId: b.id } });
    if (existingSlots.length === 0) {
      await prisma.routineSlot.createMany({
        data: [
          { batchId: b.id, dayOfWeek: day1, startTime: '16:00', endTime: '17:30' },
          { batchId: b.id, dayOfWeek: day2, startTime: '16:00', endTime: '17:30' },
        ],
      });
    }
  }

  // Attendance Records for recent days
  const recentDates = [
    new Date('2026-10-10T10:00:00Z'),
    new Date('2026-10-12T10:00:00Z'),
    new Date('2026-10-14T10:00:00Z'),
  ];

  const attendanceRecords = [];
  for (let i = 0; i < 20; i++) {
    const student = students[i];
    const batch = batches[i % batches.length];
    for (const d of recentDates) {
      const status = i % 5 === 0 ? AttendanceStatus.ABSENT : i % 7 === 0 ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;
      attendanceRecords.push({
        studentId: student.id,
        batchId: batch.id,
        date: d,
        status,
        markedById: teachers[0].id,
      });
    }
  }
  await prisma.attendance.createMany({ data: attendanceRecords, skipDuplicates: true });

  // ==========================================
  // 7. Tests, Questions & Options
  // ==========================================
  console.log('Seeding tests and questions...');
  for (let i = 0; i < batches.length; i++) {
    const b = batches[i];
    const existingTest = await prisma.test.findFirst({ where: { batchId: b.id } });

    if (!existingTest) {
      const test = await prisma.test.create({
        data: {
          title: `${b.name} - Chapter Milestone Assessment`,
          type: TestType.MCQ,
          batchId: b.id,
          totalMarks: 25,
          negativeMarkingValue: 0.25,
          durationMinutes: 30,
          testDate: new Date('2026-10-15T15:00:00Z'),
          createdById: b.teacherId || teachers[0].id,
          questions: {
            create: [
              {
                text: 'What is the scalar product of two orthogonal non-zero vectors A and B?',
                type: QuestionType.MCQ,
                marks: 5,
                order: 1,
                options: {
                  create: [
                    { text: '0', isCorrect: true },
                    { text: '1', isCorrect: false },
                    { text: '|A||B|', isCorrect: false },
                    { text: '-1', isCorrect: false },
                  ],
                },
              },
              {
                text: 'In uniform circular motion, the direction of centripetal acceleration is always:',
                type: QuestionType.MCQ,
                marks: 5,
                order: 2,
                options: {
                  create: [
                    { text: 'Towards the center of the circular trajectory', isCorrect: true },
                    { text: 'Tangential to the velocity vector', isCorrect: false },
                    { text: 'Away from the center radially outward', isCorrect: false },
                    { text: 'Opposite to angular velocity', isCorrect: false },
                  ],
                },
              },
            ],
          },
        },
      });
    }
  }

  // ==========================================
  // 8. Reviews (30+ authentic student reviews)
  // ==========================================
  console.log('Seeding 30+ batch reviews...');
  const reviewComments = [
    'Dr. Anisur Sir vector and mechanics lectures cleared all my doubts for board and admission exams.',
    'The weekly chapter-wise exams and instant analytics helped me identify my weak spots in organic chemistry.',
    'Tanvir Sir shortcut techniques for integration saved me immense time during engineering model tests.',
    'The lecture sheets are exceptionally organized. I did not need to consult any auxiliary guide books.',
    'Diagram-oriented biology memorization techniques by Dr. Nusrat Apa made human physiology intuitive.',
    'Class routine and exam schedules are strictly maintained. Best coaching experience in Dhanmondi.',
    'The ICT C-programming live debug sessions gave me the confidence to score full marks in board practicals.',
    'Regular SMS updates to guardians kept my parents assured about my attendance and progress.',
    'Model test questions reflect the exact standard of BUET and Medical entrance question papers.',
    'Teacher accessibility after class for personalized problem-solving sets EduFlow apart from other centers.',
    'The organic reaction flowcharts alone are worth the course enrollment. Truly transformative guidance.',
    'Higher math coordinate geometry proofs became my highest-scoring section thanks to this batch.',
    'Clear blackboard explanations with real-world analogies make difficult physics problems effortless.',
    'Doubt clearing support via the student portal ensured I never fell behind the syllabus pace.',
    'High-pressure timed tests prepared me psychologically for the actual board exam examination hall.',
    'Comprehensive coverage of every corner of the NCTB textbook without leaving out tricky derivations.',
    'The classroom ambiance and discipline are top-notch. Faculty members genuinely care about each student.',
    'Structured installment payment system made it very convenient for my family to budget educational costs.',
    'Extremely beneficial problem banks with step-by-step verified answer explanations.',
    'From getting 65% in college terms to achieving consistent 90%+ marks, EduFlow transformed my prep.',
    'Medical admission sprint biology questions matched nearly 80% of concepts asked in the real exam.',
    'The teacher breakdown of electrochemistry cell potentials made physical chemistry my favorite subject.',
    'The digital routine and online submission portal made tracking my studies frictionless.',
    'Very friendly faculty members who explain the same derivation multiple times until everyone grasps it.',
    'The mock rank lists gave me an accurate benchmark of where I stand among competitors across Dhaka.',
    'Grammar modifying rules and connectors were taught with such logic that writing essays felt natural.',
    'Best coaching center in Uttara for science students. Clean facilities and spacious modern classrooms.',
    'Every homework assignment is meticulously graded with written teacher remarks pointing out mistakes.',
    'Formula sheet summaries provided before final exams were absolute lifesavers during last-minute revision.',
    'Transparent attendance logs and prompt SMS notifications kept my daily routine disciplined and focused.',
    'The analytical depth taught here is leagues ahead of traditional rote-learning coaching centers.',
    'I strongly recommend EduFlow to any student aspiring for top engineering or medical institutions.',
  ];

  const reviewRecords = [];
  for (let i = 0; i < reviewComments.length; i++) {
    const student = students[i % students.length];
    const batch = batches[i % batches.length];
    const rating = (i % 6 === 0) ? 4 : 5;
    reviewRecords.push({
      batchId: batch.id,
      studentId: student.id,
      rating,
      comment: reviewComments[i],
    });
  }

  await prisma.review.createMany({ data: reviewRecords, skipDuplicates: true });
  console.log(`Seeded ${reviewRecords.length} batch reviews.`);

  // ==========================================
  // 9. Blog Posts (6 full-length articles)
  // ==========================================
  console.log('Seeding 6 full-length blog posts...');
  const blogPostsData = [
    {
      slug: 'how-to-master-hsc-higher-math-calculus',
      title: 'How to Master HSC Higher Mathematics Calculus: A Step-by-Step Blueprint',
      excerpt: 'Calculus carries nearly 25% of the total marks in HSC Higher Mathematics Paper 1. Learn the conceptual hierarchy, standard substitutions, and common pitfall traps.',
      category: 'HSC Preparation',
      authorName: 'Tanvir Ahmed Chowdhury',
      coverImage: trackImage('https://images.unsplash.com/photo-1509228468518-180dd4864904?auto=format&fit=crop&w=1200&q=80'),
      isPublished: true,
      publishedAt: new Date('2026-09-01T08:00:00Z'),
      content: `## The Strategic Significance of Calculus in HSC

Calculus forms the intellectual backbone of HSC Higher Mathematics Paper 1. Divided into Differential Calculus (Chapter 9) and Integral Calculus (Chapter 10), this domain tests both algebraic precision and geometric imagination.

### 1. Foundation: The Limit Concept and Continuity
Before attempting mechanical differentiation rules, students must develop an intuitive understanding of epsilon-delta limits. Key focus areas include:
- Standard trigonometric limits like $\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$
- Exponential limits involving Euler's constant $e$
- L'Hôpital's rule application for checking $0/0$ indeterminate forms

### 2. Differential Calculus Mastery
Mastering derivatives requires internalizing the chain rule until it becomes second nature:
- **First Principles (Mool Niyom):** Every year, one 4-mark question in Group C asks for differentiation from first principles. Memorize derivations for $\\sin(ax)$, $\\ln(\\cos x)$, and $e^{\\sqrt{x}}$.
- **Successive Differentiation:** Focus on finding $n$-th derivatives of rational fractions and applying Leibniz's Theorem.
- **Tangent and Normal Equations:** Understand the geometric meaning of $dy/dx$ at a given point on a curve.

### 3. Conquering Integral Calculus
Integration is the reverse process of differentiation, but requires pattern recognition:
- **Substitution Method:** Look for the inner derivative hiding within the integrand.
- **Integration by Parts (LIATE Rule):** Logarithmic, Inverse trigonometric, Algebraic, Trigonometric, Exponential.
- **Definite Integrals and Area Calculation:** Practice evaluating areas bounded by parabolas and straight lines using definite integrals.

Regular practice of 10 problems daily will turn calculus into your highest-scoring topic.`,
    },
    {
      slug: 'buet-admission-test-strategy-and-roadmap',
      title: 'BUET Admission Test Strategy: Complete Roadmap from HSC to Red Building',
      excerpt: 'An insider guide on tackling the preliminary screening and written tests of Bangladesh University of Engineering and Technology (BUET) with precision.',
      category: 'Engineering Admission',
      authorName: 'Dr. Anisur Rahman',
      coverImage: trackImage('https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80'),
      isPublished: true,
      publishedAt: new Date('2026-09-10T08:00:00Z'),
      content: `## Demystifying the BUET Entrance Examination

Gaining admission to BUET is the dream of over 50,000 science students across Bangladesh each year. However, fewer than 1,300 earn a seat inside the storied Red Building campus.

### Phase 1: The Preliminary Screening Test
The preliminary test is a 100-mark MCQ exam with negative marking of 0.25 marks per incorrect answer:
- **Time Pressure:** You have 60 minutes for 100 questions. Speed and triage are vital.
- **Question Distribution:** Physics, Chemistry, and Mathematics each carry balanced weight.
- **Triage Strategy:** Never spend more than 40 seconds on an initial reading. Solve all trivial questions first, mark moderate ones for pass 2, and skip calculation-heavy questions entirely.

### Phase 2: The Final Written Exam
The written test consists of 60 questions worth 600 total marks:
- **Space Management:** You are provided a fixed boxed area under each question. Write legible, concise equations without unnecessary narrative prose.
- **Unit and Significant Figures:** Always write final numerical values with accurate SI units. Omitting units can cost 1 to 2 marks per question.
- **Multi-Concept Problems:** BUET questions frequently integrate multiple domains—such as combining thermodynamics with gas laws or electrostatic forces with circular dynamics.

Prepare methodically, solve the past 25 years of BUET question papers, and cultivate calm under exam stress.`,
    },
    {
      slug: 'mastering-organic-chemistry-reactions-for-hsc',
      title: 'Mastering Organic Chemistry Reactions: The Secret Flowchart Technique',
      excerpt: 'Stop blindly memorizing organic chemistry reactions. Learn how functional group flowcharts and reaction mechanisms provide effortless memory retention.',
      category: 'HSC Preparation',
      authorName: 'Farhana Yasmin',
      coverImage: trackImage('https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?auto=format&fit=crop&w=1200&q=80'),
      isPublished: true,
      publishedAt: new Date('2026-09-18T08:00:00Z'),
      content: `## Why Organic Chemistry Overwhelms Students

HSC Chemistry Paper 2, Chapter 2 (Organic Chemistry) comprises over 150 individual named reactions, reagents, and conversions. Students who attempt rote memorization invariably mix up reagents during exams.

### The Flowchart Solution: The Carbon Backbone Highway
Instead of treating reactions as isolated formulas, construct a single connected reaction network:
1. **The Hub (Alkanes to Alkyl Halides):** Free radical halogenation converts inert alkanes into reactive alkyl halides.
2. **The Branching Point (Nucleophilic Substitution):**
   - Aqueous $KOH$ yields Alcohols
   - Alcoholic $KOH$ produces Alkenes via elimination
   - Alcoholic $KCN$ lengthens the carbon chain by adding a nitrile group
3. **The Oxidation Ladder:** Primary Alcohol $\\to$ Aldehyde $\\to$ Carboxylic Acid.

### Key Named Reactions That Appear Consistently
- **Cannizzaro Reaction:** Aldehydes lacking $\\alpha$-hydrogen undergoing self-oxidation and reduction in concentrated alkali.
- **Aldol Condensation:** Carbonyls with $\\alpha$-hydrogen forming $\\beta$-hydroxy aldehydes.
- **Friedel-Crafts Alkylation & Acylation:** Electrophilic aromatic substitution on benzene rings.

By drawing this flowchart on an A3 poster and reviewing it for 10 minutes every morning, your organic retention will skyrocket.`,
    },
    {
      slug: 'medical-college-admission-preparation-guide',
      title: 'Medical College Admission Preparation: A Compass for Pre-Med Aspirants',
      excerpt: 'How to conquer the 100-mark DGHS Medical Admission Exam. Strategies for Biology retention, Chemistry quick-math, and English General Knowledge.',
      category: 'Medical Admission',
      authorName: 'Dr. Nusrat Jahan',
      coverImage: trackImage('https://images.unsplash.com/photo-1530497610245-94d3c16cda28?auto=format&fit=crop&w=1200&q=80'),
      isPublished: true,
      publishedAt: new Date('2026-09-25T08:00:00Z'),
      content: `## The Anatomy of the Medical Admission Test

The medical entrance test conducted by the Directorate General of Health Services (DGHS) is arguably the most competitive single-hour exam in Bangladesh:
- **Biology (30 Marks):** The deciding differentiator.
- **Chemistry (25 Marks):** High proportion of qualitative and memory-based questions.
- **Physics (20 Marks):** Conceptual questions and non-calculator mental arithmetic.
- **English (15 Marks):** Vocabulary, idioms, preposition collocations, and error identification.
- **General Knowledge (10 Marks):** Liberation War history, Bangladesh heritage, and notable current affairs.

### Tactical Guidelines
1. **Textbook Primacy:** Treat the primary textbooks (Gazi Ajmol for Zoology, Abul Hasan for Botany, Hazari-Nag for Chemistry, Isahaque for Physics) as your ultimate authority. Every question is sourced directly from their sentences.
2. **Mental Math without Calculators:** Since calculators are prohibited, practice calculating square roots, logs, and fractional divisions manually.
3. **Active Recall via Practice Tests:** Taking at least thirty 100-mark OMR tests under timed conditions will build the stamina required to score 75+ marks.`,
    },
    {
      slug: 'top-study-techniques-for-hsc-board-examinees',
      title: 'Top 5 Scientifically Proven Study Techniques for HSC Board Examinees',
      excerpt: 'Boost your retention by 200% with Active Recall, Spaced Repetition, the Feynman Technique, Pomodoro Intervals, and Interleaving Practice.',
      category: 'Study Tips',
      authorName: 'Kazi Mashiur Rahman',
      coverImage: trackImage('https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=1200&q=80'),
      isPublished: true,
      publishedAt: new Date('2026-10-02T08:00:00Z'),
      content: `## Moving Beyond Passive Highlighting

Most students spend hundreds of hours re-reading notes and highlighting textbooks. Cognitive psychology shows that passive review creates an illusion of competence without genuine long-term memory consolidation.

### 1. Active Recall
Close your book after studying a chapter and write down everything you remember on a blank sheet of paper. Compare what you recalled against the book to expose exact blind spots.

### 2. Spaced Repetition
Do not cram a subject once and leave it for weeks. Review material on intervals: Day 1, Day 3, Day 7, Day 21, and Day 45.

### 3. The Feynman Technique
Explain complex physics or biology concepts in plain Bangla as if teaching an eighth-grade student. If you encounter jargon you cannot explain simply, you have pinpointed a gap in your own understanding.

### 4. Interleaving vs. Blocked Practice
Instead of solving 50 consecutive problems on a single topic, mix 5 mechanics problems, 5 calculus problems, and 5 stoichiometry equations in one session. This mirrors the diverse format of actual exams.`,
    },
    {
      slug: 'balancing-coaching-classes-and-self-study-effectively',
      title: 'Balancing Coaching Classes and Self-Study: The 1:2 Golden Ratio Rule',
      excerpt: 'Attending lectures without dedicated self-study leads to burnout and exam anxiety. Discover how top board rankers structure their daily study schedules.',
      category: 'Study Tips',
      authorName: 'Syeda Mahfuza Khatun',
      coverImage: trackImage('https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=1200&q=80'),
      isPublished: true,
      publishedAt: new Date('2026-10-08T08:00:00Z'),
      content: `## The Coaching Trap: Why More Classes Do Not Equal Better Results

A common pitfall among HSC candidates is hopping between multiple coaching classes and private tutors from 7:00 AM to 6:00 PM, leaving zero mental energy for personal homework and reflection.

### The Golden Ratio: 1 Hour of Class = 2 Hours of Self-Study
If you attend a 1.5-hour lecture on electromagnetism, your daily schedule must carve out 3 uninterrupted hours that same evening to:
1. Re-derive every formula presented by the lecturer on your own.
2. Solve the corresponding textbook exercise problems without looking at solved guides.
3. Formulate two specific questions for the teacher to answer in the next session.

### The Ideal Daily Routine for HSC Candidates
- **06:00 AM - 08:30 AM:** High-focus self-study (Mathematics or Physics derivations).
- **09:00 AM - 01:00 PM:** College classes or morning laboratory work.
- **03:30 PM - 05:30 PM:** EduFlow interactive coaching lecture and weekly exam.
- **07:00 PM - 10:30 PM:** Deep focused self-study applying the 1:2 rule.
- **11:00 PM:** Adequate rest for cognitive memory consolidation.`,
    },
  ];

  for (const p of blogPostsData) {
    await prisma.blogPost.upsert({
      where: { slug: p.slug },
      update: {
        title: p.title,
        excerpt: p.excerpt,
        content: p.content,
        category: p.category,
        authorName: p.authorName,
        coverImage: p.coverImage,
        isPublished: p.isPublished,
        publishedAt: p.publishedAt,
      },
      create: {
        slug: p.slug,
        title: p.title,
        excerpt: p.excerpt,
        content: p.content,
        category: p.category,
        authorName: p.authorName,
        coverImage: p.coverImage,
        isPublished: p.isPublished,
        publishedAt: p.publishedAt,
      },
    });
  }
  console.log(`Seeded ${blogPostsData.length} full-length blog posts.`);

  // ==========================================
  // 10. Testimonials (8 realistic student testimonials)
  // ==========================================
  console.log('Seeding 8 student testimonials...');
  const testimonialsData = [
    {
      name: 'Shadman Sakib',
      roleTitle: 'BUET CSE \'24 (Former HSC Batch \'23)',
      content: 'EduFlow engineering program was instrumental in my BUET admission. Dr. Anisur Sir taught us how to deconstruct multi-step physics problems in minutes.',
      avatarUrl: trackImage('https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=400&q=80'),
      rating: 5,
      isFeatured: true,
    },
    {
      name: 'Maliha Tasnim',
      roleTitle: 'Dhaka Medical College (K-81 Batch)',
      content: 'The line-by-line textbook analysis and weekly OMR model test series at EduFlow gave me the exact speed and accuracy required to secure a DMC seat.',
      avatarUrl: trackImage('https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80'),
      rating: 5,
      isFeatured: true,
    },
    {
      name: 'Abrar Fahad Chowdhury',
      roleTitle: 'IUT Software Engineering \'24',
      content: 'The mathematics shortcuts and calculus problem-solving clinics conducted by Tanvir Sir gave me a clear competitive edge in university entrance exams.',
      avatarUrl: trackImage('https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=400&q=80'),
      rating: 5,
      isFeatured: true,
    },
    {
      name: 'Tanzila Haque',
      roleTitle: 'Notre Dame College (HSC Golden A+)',
      content: 'Organic chemistry was once my biggest nightmare. Farhana Maam visual reaction maps completely transformed my understanding and exam confidence.',
      avatarUrl: trackImage('https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&q=80'),
      rating: 5,
      isFeatured: true,
    },
    {
      name: 'Rahat Mahmud',
      roleTitle: 'University of Dhaka (Applied Chemistry)',
      content: 'The disciplined attendance tracking, regular guardian progress reports, and dedicated doubt-clearing sessions make EduFlow Dhaka finest coaching.',
      avatarUrl: trackImage('https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=400&q=80'),
      rating: 5,
      isFeatured: true,
    },
    {
      name: 'Nazifa Tabassum',
      roleTitle: 'Mymensingh Medical College',
      content: 'The botany and zoology mnemonics provided in lecture sheets ensured I did not lose a single mark in the medical admission biology section.',
      avatarUrl: trackImage('https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=400&q=80'),
      rating: 5,
      isFeatured: true,
    },
    {
      name: 'Fardeen Ahsan',
      roleTitle: 'KUET Mechanical Engineering',
      content: 'Offline model exams every Saturday with negative marking prepared me mentally for the high-pressure engineering admission hall environment.',
      avatarUrl: trackImage('https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=400&q=80'),
      rating: 5,
      isFeatured: true,
    },
    {
      name: 'Samira Anjum',
      roleTitle: 'Viqarunnisa Noon College (HSC Batch \'24)',
      content: 'ICT C-programming and digital logic became my highest-scoring paper. The teachers are approachable and truly invested in student success.',
      avatarUrl: trackImage('https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80'),
      rating: 5,
      isFeatured: true,
    },
  ];

  for (const t of testimonialsData) {
    const existing = await prisma.testimonial.findFirst({ where: { name: t.name } });
    if (!existing) {
      await prisma.testimonial.create({ data: t });
    } else {
      await prisma.testimonial.update({ where: { id: existing.id }, data: t });
    }
  }
  console.log(`Seeded ${testimonialsData.length} student testimonials.`);

  // ==========================================
  // 11. FAQ Items (10 realistic coaching FAQs)
  // ==========================================
  console.log('Seeding 10 FAQ items...');
  const faqsData = [
    {
      question: 'How do I enroll in a batch at EduFlow?',
      answer: 'You can visit any of our physical branches in Dhanmondi, Uttara, or Mirpur to register in person, or submit an admission request through our online student portal.',
      category: 'Admissions',
      sortOrder: 1,
    },
    {
      question: 'Can I attend trial classes before confirming enrollment?',
      answer: 'Yes! We offer two complimentary orientation classes for newly admitted students so you can experience our teaching methodology firsthand before payment.',
      category: 'Admissions',
      sortOrder: 2,
    },
    {
      question: 'What happens if a student misses a scheduled lecture?',
      answer: 'All lecture notes and digital companion materials are archived in the student portal. Students can also attend weekend makeup clinics with faculty approval.',
      category: 'Academic Programs',
      sortOrder: 3,
    },
    {
      question: 'How are weekly model exams conducted and graded?',
      answer: 'Exams are administered under standard board conditions using OMR sheets for MCQs and structured scripts for creative questions. Results and merit ranks are published within 48 hours.',
      category: 'Examinations & Grading',
      sortOrder: 4,
    },
    {
      question: 'Do guardians receive attendance and test score notifications?',
      answer: 'Yes, our automated SMS and portal alert system notifies linked guardians immediately if a student is absent or late, and sends full score summaries after each exam.',
      category: 'Examinations & Grading',
      sortOrder: 5,
    },
    {
      question: 'Are coaching fees payable in monthly installments?',
      answer: 'Academic batches operate on a standard monthly fee cycle due by the 15th of each calendar month. Admission test crash programs offer two-stage installment options.',
      category: 'Fees & Payments',
      sortOrder: 6,
    },
    {
      question: 'What payment methods does EduFlow accept?',
      answer: 'We accept bKash, Nagad, Rocket, major debit and credit cards, as well as direct cash payment at branch administrative counters.',
      category: 'Fees & Payments',
      sortOrder: 7,
    },
    {
      question: 'What is the teacher-to-student ratio in each classroom?',
      answer: 'To ensure personalized attention, our academic batches are capped at 35 to 40 students per classroom with dedicated teaching assistants present during problem-solving sessions.',
      category: 'Academic Programs',
      sortOrder: 8,
    },
    {
      question: 'Are specialized study materials and lecture sheets provided?',
      answer: 'Yes, every enrolled student receives printed chapter-by-chapter lecture sheets, formula summaries, and comprehensive board question banks at no additional cost.',
      category: 'Academic Programs',
      sortOrder: 9,
    },
    {
      question: 'Can students switch between branches if their residence changes?',
      answer: 'Yes, with prior administrative clearance from the campus coordinator, students may transfer their active enrollment between Dhanmondi, Uttara, or Mirpur branches.',
      category: 'Admissions',
      sortOrder: 10,
    },
  ];

  for (const f of faqsData) {
    const existing = await prisma.faqItem.findFirst({ where: { question: f.question } });
    if (!existing) {
      await prisma.faqItem.create({ data: f });
    } else {
      await prisma.faqItem.update({ where: { id: existing.id }, data: f });
    }
  }
  console.log(`Seeded ${faqsData.length} FAQ items.`);

  // ==========================================
  // Print image URLs for verification
  // ==========================================
  console.log('\n======================================================');
  console.log(`VERIFIED UNSPLASH IMAGE URLS (${collectedImageUrls.length} total)`);
  console.log('======================================================');
  collectedImageUrls.forEach((url, idx) => {
    console.log(`${idx + 1}. ${url}`);
  });
  console.log('======================================================\n');

  console.log('EduFlow database seeding completed successfully!');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('Seed execution error:', e);
    await prisma.$disconnect();
    process.exit(1);
  });

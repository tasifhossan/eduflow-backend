import { Request, Response } from 'express';
import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import { createGuardianSchema, linkGuardianSchema } from '../validators/guardian.validator';

const prisma = new PrismaClient();

export async function createGuardianAccount(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const parseResult = createGuardianSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { name, email, phone, password } = parseResult.data;
    const branchId = req.user.branchId;

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'A user with this email already exists',
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone: phone || null,
        password: hashedPassword,
        role: Role.GUARDIAN,
        branchId,
      },
    });

    const { password: _, ...userWithoutPassword } = user;

    return res.status(201).json({
      success: true,
      message: 'Guardian account created successfully',
      data: userWithoutPassword,
    });
  } catch (error) {
    console.error('Create guardian account error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function linkGuardianToStudent(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const parseResult = linkGuardianSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { guardianId, studentId } = parseResult.data;
    const branchId = req.user.branchId;

    // Verify guardian exists, is a GUARDIAN, and belongs to same branch
    const guardian = await prisma.user.findUnique({
      where: { id: guardianId },
    });
    if (!guardian || guardian.branchId !== branchId || guardian.role !== Role.GUARDIAN) {
      return res.status(404).json({
        success: false,
        message: 'Guardian not found or access denied',
      });
    }

    // Verify student exists, is a STUDENT, and belongs to same branch
    const student = await prisma.user.findUnique({
      where: { id: studentId },
    });
    if (!student || student.branchId !== branchId || student.role !== Role.STUDENT) {
      return res.status(404).json({
        success: false,
        message: 'Student not found or access denied',
      });
    }

    // Check if link already exists
    const existingLink = await prisma.guardianLink.findUnique({
      where: {
        guardianId_studentId: {
          guardianId,
          studentId,
        },
      },
    });
    if (existingLink) {
      return res.status(409).json({
        success: false,
        message: 'Guardian is already linked to this student',
      });
    }

    const link = await prisma.guardianLink.create({
      data: {
        guardianId,
        studentId,
      },
      include: {
        guardian: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        student: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Guardian linked to student successfully',
      data: link,
    });
  } catch (error) {
    console.error('Link guardian to student error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getMyLinkedStudents(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const guardianId = req.user.userId;

    const links = await prisma.guardianLink.findMany({
      where: { guardianId },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            guardianName: true,
            guardianPhone: true,
            enrollments: {
              include: {
                batch: {
                  select: {
                    id: true,
                    name: true,
                    type: true,
                    classLevel: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const students = links.map((link) => link.student);

    return res.status(200).json({
      success: true,
      message: 'Linked students retrieved successfully',
      data: students,
    });
  } catch (error) {
    console.error('Get my linked students error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getLinkedStudentAttendance(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const guardianId = req.user.userId;
    const studentId = req.params.studentId as string;

    // Explicit security boundary: verify GuardianLink exists
    const link = await prisma.guardianLink.findUnique({
      where: {
        guardianId_studentId: {
          guardianId,
          studentId,
        },
      },
    });

    if (!link) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied. Guardian is not linked to this student',
      });
    }

    const batchId = req.query.batchId as string | undefined;

    const whereClause: any = { studentId };
    if (batchId) {
      whereClause.batchId = batchId;
    }

    const attendance = await prisma.attendance.findMany({
      where: whereClause,
      include: {
        batch: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
      orderBy: {
        date: 'desc',
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Linked student attendance retrieved successfully',
      data: attendance,
    });
  } catch (error) {
    console.error('Get linked student attendance error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getLinkedStudentResults(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const guardianId = req.user.userId;
    const studentId = req.params.studentId as string;

    // Explicit security boundary: verify GuardianLink exists
    const link = await prisma.guardianLink.findUnique({
      where: {
        guardianId_studentId: {
          guardianId,
          studentId,
        },
      },
    });

    if (!link) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied. Guardian is not linked to this student',
      });
    }

    const results = await prisma.result.findMany({
      where: { studentId },
      include: {
        test: {
          select: {
            id: true,
            title: true,
            type: true,
            totalMarks: true,
            testDate: true,
            batch: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        submittedAt: 'desc',
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Linked student test results retrieved successfully',
      data: results,
    });
  } catch (error) {
    console.error('Get linked student results error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getLinkedStudentPayments(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const guardianId = req.user.userId;
    const studentId = req.params.studentId as string;

    // Explicit security boundary: verify GuardianLink exists
    const link = await prisma.guardianLink.findUnique({
      where: {
        guardianId_studentId: {
          guardianId,
          studentId,
        },
      },
    });

    if (!link) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied. Guardian is not linked to this student',
      });
    }

    const payments = await prisma.feePayment.findMany({
      where: { studentId },
      include: {
        batch: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Linked student payments retrieved successfully',
      data: payments,
    });
  } catch (error) {
    console.error('Get linked student payments error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

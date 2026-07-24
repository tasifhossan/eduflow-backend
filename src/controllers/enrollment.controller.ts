import { Request, Response } from 'express';
import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import { createStudentSchema, enrollStudentSchema } from '../validators/enrollment.validator';

const prisma = new PrismaClient();

export async function createStudent(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const parseResult = createStudentSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { name, email, phone, password, guardianName, guardianPhone } = parseResult.data;
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

    // Create student user
    const student = await prisma.user.create({
      data: {
        name,
        email,
        phone: phone || null,
        password: hashedPassword,
        role: Role.STUDENT,
        branchId,
        guardianName: guardianName || null,
        guardianPhone: guardianPhone || null,
      },
    });

    // Remove password from response
    const { password: _, ...studentWithoutPassword } = student;

    return res.status(201).json({
      success: true,
      message: 'Student account created successfully',
      data: studentWithoutPassword,
    });
  } catch (error) {
    console.error('Create student error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function enrollStudent(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const parseResult = enrollStudentSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { studentId, batchId } = parseResult.data;
    const branchId = req.user.branchId;

    // Verify student exists and belongs to the same branch
    const student = await prisma.user.findUnique({
      where: { id: studentId },
    });
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found',
      });
    }
    if (student.role !== Role.STUDENT || student.branchId !== branchId) {
      return res.status(403).json({
        success: false,
        message: 'Student does not belong to your branch or is not a student',
      });
    }

    // Verify batch exists and belongs to the same branch
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
    });
    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found',
      });
    }
    if (batch.branchId !== branchId) {
      return res.status(403).json({
        success: false,
        message: 'Batch does not belong to your branch',
      });
    }

    // Check if enrollment already exists
    const existingEnrollment = await prisma.enrollment.findUnique({
      where: {
        studentId_batchId: { studentId, batchId },
      },
    });

    if (existingEnrollment) {
      if (existingEnrollment.status === 'ACTIVE') {
        return res.status(409).json({
          success: false,
          message: 'Student is already enrolled in this batch',
        });
      } else {
        // Reactivate enrollment
        const updatedEnrollment = await prisma.enrollment.update({
          where: { id: existingEnrollment.id },
          data: { status: 'ACTIVE' },
        });
        return res.status(200).json({
          success: true,
          message: 'Student enrollment reactivated successfully',
          data: updatedEnrollment,
        });
      }
    }

    // Create new enrollment
    const enrollment = await prisma.enrollment.create({
      data: {
        studentId,
        batchId,
        status: 'ACTIVE',
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Student enrolled successfully',
      data: enrollment,
    });
  } catch (error) {
    console.error('Enroll student error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getStudentsByBatch(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const batchId = req.params.batchId as string;
    const branchId = req.user.branchId;

    // Verify batch belongs to user's branch
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
    });
    if (!batch || batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found or access denied',
      });
    }

    const enrollments = await prisma.enrollment.findMany({
      where: {
        batchId,
        status: 'ACTIVE',
      },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            guardianName: true,
            guardianPhone: true,
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Students retrieved successfully',
      data: enrollments.map((e) => e.student),
    });
  } catch (error) {
    console.error('Get students by batch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getBatchesByStudent(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const studentId = req.params.studentId as string;
    const branchId = req.user.branchId;

    // Authorization checks: STUDENT role can only request their own ID
    if (req.user.role === Role.STUDENT && req.user.userId !== studentId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to other students batches',
      });
    }

    // Verify student belongs to the same branch
    const student = await prisma.user.findUnique({
      where: { id: studentId },
    });
    if (!student || student.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Student not found or access denied',
      });
    }

    const enrollments = await prisma.enrollment.findMany({
      where: {
        studentId,
        status: 'ACTIVE',
      },
      include: {
        batch: {
          include: {
            subject: {
              select: { name: true },
            },
            teacher: {
              select: { name: true },
            },
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Batches retrieved successfully',
      data: enrollments.map((e) => e.batch),
    });
  } catch (error) {
    console.error('Get batches by student error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function unenrollStudent(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const branchId = req.user.branchId;

    // Check if enrollment exists and scope by branch (via batch)
    const enrollment = await prisma.enrollment.findUnique({
      where: { id },
      include: {
        batch: true,
      },
    });

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: 'Enrollment record not found',
      });
    }

    if (enrollment.batch.branchId !== branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to this enrollment record',
      });
    }

    // Unenroll (soft unenroll by setting to INACTIVE)
    const updated = await prisma.enrollment.update({
      where: { id },
      data: {
        status: 'INACTIVE',
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Student unenrolled successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Unenroll student error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

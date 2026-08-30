import { Request, Response } from 'express';
import { PrismaClient, Role } from '@prisma/client';
import { updateStudentSchema } from '../validators/student.validator';

const prisma = new PrismaClient();

export async function getStudentsWithSummary(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const branchId = req.user.branchId;

    const students = await prisma.user.findMany({
      where: {
        role: Role.STUDENT,
        branchId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        guardianName: true,
        guardianPhone: true,
        createdAt: true,
        studentGuardians: {
          select: {
            guardian: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
              },
            },
          },
        },
        _count: {
          select: {
            enrollments: true,
          },
        },
        attendances: {
          select: {
            status: true,
            date: true,
            batch: {
              select: {
                name: true,
              },
            },
          },
          orderBy: {
            date: 'desc',
          },
          take: 1,
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

    const formattedStudents = students.map((student) => {
      const { _count, attendances, studentGuardians, ...rest } = student;
      return {
        ...rest,
        linkedGuardians: studentGuardians.map((g) => g.guardian),
        enrolledBatchesCount: _count.enrollments,
        recentAttendance: attendances.length > 0 ? {
          status: attendances[0].status,
          date: attendances[0].date,
          batchName: attendances[0].batch.name,
        } : null,
      };
    });

    return res.status(200).json({
      success: true,
      message: 'Students summary retrieved successfully',
      data: formattedStudents,
    });
  } catch (error) {
    console.error('Get students with summary error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function updateStudent(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const branchId = req.user.branchId;
    const adminId = req.user.userId;

    const parseResult = updateStudentSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const existingStudent = await prisma.user.findUnique({
      where: { id },
      include: {
        studentGuardians: {
          select: { id: true },
        },
      },
    });

    if (!existingStudent || existingStudent.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Student not found or access denied',
      });
    }

    const { name, phone, guardianName, guardianPhone } = parseResult.data;

    // Block manual edits to guardian contact info if student is linked to a guardian account
    if (existingStudent.studentGuardians.length > 0) {
      const isEditingName = guardianName !== undefined && guardianName !== existingStudent.guardianName;
      const isEditingPhone = guardianPhone !== undefined && guardianPhone !== existingStudent.guardianPhone;

      if (isEditingName || isEditingPhone) {
        return res.status(400).json({
          success: false,
          message:
            "Guardian contact info is managed by the linked guardian account and cannot be edited directly. Update the guardian's own account instead, or unlink first.",
        });
      }
    }

    // Detect guardian field changes for audit logging
    const logsToCreate: Array<{
      studentId: string;
      field: string;
      oldValue: string | null;
      newValue: string | null;
      changedById: string;
    }> = [];

    if (guardianName !== undefined && guardianName !== existingStudent.guardianName) {
      logsToCreate.push({
        studentId: id,
        field: 'guardianName',
        oldValue: existingStudent.guardianName,
        newValue: guardianName,
        changedById: adminId,
      });
    }

    if (guardianPhone !== undefined && guardianPhone !== existingStudent.guardianPhone) {
      logsToCreate.push({
        studentId: id,
        field: 'guardianPhone',
        oldValue: existingStudent.guardianPhone,
        newValue: guardianPhone,
        changedById: adminId,
      });
    }

    // Execute update & audit logs creation in a single transaction
    const updatedStudent = await prisma.$transaction(async (tx) => {
      for (const logData of logsToCreate) {
        await tx.guardianInfoChangeLog.create({
          data: logData,
        });
      }

      return await tx.user.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(phone !== undefined && { phone }),
          ...(guardianName !== undefined && { guardianName }),
          ...(guardianPhone !== undefined && { guardianPhone }),
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          guardianName: true,
          guardianPhone: true,
          role: true,
          branchId: true,
          createdAt: true,
        },
      });
    });

    return res.status(200).json({
      success: true,
      message: 'Student updated successfully',
      data: updatedStudent,
    });
  } catch (error) {
    console.error('Update student error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getGuardianChangeLog(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const branchId = req.user.branchId;

    const student = await prisma.user.findUnique({
      where: { id },
      select: { id: true, branchId: true },
    });

    if (!student || student.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Student not found or access denied',
      });
    }

    const logs = await prisma.guardianInfoChangeLog.findMany({
      where: { studentId: id },
      include: {
        changedBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { changedAt: 'desc' },
    });

    return res.status(200).json({
      success: true,
      message: 'Guardian change log retrieved successfully',
      data: logs,
    });
  } catch (error) {
    console.error('Get guardian change log error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

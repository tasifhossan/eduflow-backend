import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { createAuditLog } from '../utils/audit';

const createSubjectSchema = z.object({
  name: z.string().min(2, 'Subject name must be at least 2 characters long'),
});

const updateSubjectSchema = z.object({
  name: z.string().min(2, 'Subject name must be at least 2 characters long'),
});

export async function getSubjects(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const subjects = await prisma.subject.findMany({
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Subjects retrieved successfully',
      data: subjects,
    });
  } catch (error) {
    console.error('Get subjects error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function createSubject(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const parseResult = createSubjectSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { name } = parseResult.data;

    // Check if subject already exists
    const existingSubject = await prisma.subject.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existingSubject) {
      return res.status(409).json({
        success: false,
        message: 'A subject with this name already exists',
      });
    }

    const newSubject = await prisma.subject.create({
      data: {
        name,
      },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'CREATE_SUBJECT',
      entityType: 'Subject',
      entityId: newSubject.id,
      branchId: req.user.branchId || null,
      metadata: {
        subjectId: newSubject.id,
        name: newSubject.name,
        changedFields: ['name'],
      },
      ip: req.ip || null,
    });

    return res.status(201).json({
      success: true,
      message: 'Subject created successfully',
      data: newSubject,
    });
  } catch (error) {
    console.error('Create subject error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function updateSubject(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const existing = await prisma.subject.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Subject not found',
      });
    }

    const parseResult = updateSubjectSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { name } = parseResult.data;

    // Check duplicate name
    const duplicate = await prisma.subject.findFirst({
      where: {
        id: { not: id },
        name: { equals: name, mode: 'insensitive' },
      },
    });

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: 'A subject with this name already exists',
      });
    }

    const updated = await prisma.subject.update({
      where: { id },
      data: { name },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'UPDATE_SUBJECT',
      entityType: 'Subject',
      entityId: id,
      branchId: req.user.branchId || null,
      metadata: {
        subjectId: id,
        changedFields: ['name'],
        oldName: existing.name,
        newName: updated.name,
      },
      ip: req.ip || null,
    });

    return res.status(200).json({
      success: true,
      message: 'Subject updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Update subject error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

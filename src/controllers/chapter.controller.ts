import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { createAuditLog } from '../utils/audit';

const createChapterSchema = z.object({
  name: z.string().min(2, 'Chapter name must be at least 2 characters long'),
  subjectId: z.string().min(1, 'Subject ID is required'),
});

const updateChapterSchema = z.object({
  name: z.string().min(2, 'Chapter name must be at least 2 characters long').optional(),
  subjectId: z.string().min(1, 'Subject ID is required').optional(),
});

export async function getChapters(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const { subjectId } = req.query;

    const chapters = await prisma.chapter.findMany({
      where: subjectId ? { subjectId: String(subjectId) } : {},
      select: {
        id: true,
        name: true,
        subjectId: true,
        subject: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Chapters retrieved successfully',
      data: chapters,
    });
  } catch (error) {
    console.error('Get chapters error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function createChapter(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const parseResult = createChapterSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { name, subjectId } = parseResult.data;

    // Check if subject exists
    const subject = await prisma.subject.findUnique({
      where: { id: subjectId },
    });
    if (!subject) {
      return res.status(404).json({
        success: false,
        message: 'Subject not found',
      });
    }

    // Check if chapter already exists in this subject
    const existingChapter = await prisma.chapter.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        subjectId,
      },
    });
    if (existingChapter) {
      return res.status(409).json({
        success: false,
        message: 'A chapter with this name already exists in the selected subject',
      });
    }

    const newChapter = await prisma.chapter.create({
      data: {
        name,
        subjectId,
      },
      select: {
        id: true,
        name: true,
        subjectId: true,
        subject: {
          select: {
            name: true,
          },
        },
      },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'CREATE_CHAPTER',
      entityType: 'Chapter',
      entityId: newChapter.id,
      branchId: req.user.branchId || null,
      metadata: {
        chapterId: newChapter.id,
        subjectId: newChapter.subjectId,
        name: newChapter.name,
        changedFields: ['name', 'subjectId'],
      },
      ip: req.ip || null,
    });

    return res.status(201).json({
      success: true,
      message: 'Chapter created successfully',
      data: newChapter,
    });
  } catch (error) {
    console.error('Create chapter error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function updateChapter(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const existing = await prisma.chapter.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Chapter not found',
      });
    }

    const parseResult = updateChapterSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { name, subjectId } = parseResult.data;
    const targetSubjectId = subjectId || existing.subjectId;

    if (subjectId) {
      const subject = await prisma.subject.findUnique({
        where: { id: subjectId },
      });
      if (!subject) {
        return res.status(404).json({
          success: false,
          message: 'Subject not found',
        });
      }
    }

    if (name) {
      const duplicate = await prisma.chapter.findFirst({
        where: {
          id: { not: id },
          subjectId: targetSubjectId,
          name: { equals: name, mode: 'insensitive' },
        },
      });
      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: 'A chapter with this name already exists in the selected subject',
        });
      }
    }

    const updated = await prisma.chapter.update({
      where: { id },
      data: {
        ...(name ? { name } : {}),
        ...(subjectId ? { subjectId } : {}),
      },
      select: {
        id: true,
        name: true,
        subjectId: true,
        subject: {
          select: { name: true },
        },
      },
    });

    const changedChapterFields = Object.keys(parseResult.data).filter(
      (k) => (parseResult.data as any)[k] !== undefined
    );

    await createAuditLog({
      actorId: req.user.userId,
      action: 'UPDATE_CHAPTER',
      entityType: 'Chapter',
      entityId: id,
      branchId: req.user.branchId || null,
      metadata: {
        chapterId: id,
        subjectId: updated.subjectId,
        changedFields: changedChapterFields,
        oldName: existing.name,
        newName: updated.name,
      },
      ip: req.ip || null,
    });

    return res.status(200).json({
      success: true,
      message: 'Chapter updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Update chapter error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

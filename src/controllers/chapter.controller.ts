import { Request, Response } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
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

const reorderChaptersSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'At least one chapter ID is required'),
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
        position: true,
        createdAt: true,
        subjectId: true,
        subject: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [
        { position: 'asc' },
        { createdAt: 'asc' },
      ],
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

    // Calculate new position: max + 1
    const maxChapter = await prisma.chapter.findFirst({
      where: { subjectId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const position = maxChapter !== null && maxChapter.position !== undefined ? maxChapter.position + 1 : 0;

    const newChapter = await prisma.chapter.create({
      data: {
        name,
        subjectId,
        position,
      },
      select: {
        id: true,
        name: true,
        position: true,
        createdAt: true,
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
        position: newChapter.position,
        changedFields: ['name', 'subjectId', 'position'],
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

export async function reorderSubjectChapters(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    if (req.user.role !== Role.SUPER_ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only SUPER_ADMIN can reorder chapters',
      });
    }

    const subjectId = req.params.subjectId as string;
    const subject = await prisma.subject.findUnique({
      where: { id: subjectId },
    });
    if (!subject) {
      return res.status(404).json({
        success: false,
        message: 'Subject not found',
      });
    }

    const parseResult = reorderChaptersSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { ids } = parseResult.data;

    // Check for duplicates
    if (new Set(ids).size !== ids.length) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate chapter IDs provided',
      });
    }

    // Get all chapters for this subject
    const subjectChapters = await prisma.chapter.findMany({
      where: { subjectId },
      select: { id: true },
    });

    // The ids must be exactly the subject's chapters
    if (ids.length !== subjectChapters.length) {
      return res.status(400).json({
        success: false,
        message: `Expected exactly ${subjectChapters.length} chapter IDs for this subject, got ${ids.length}`,
      });
    }

    const existingIdSet = new Set(subjectChapters.map((c) => c.id));
    const allValid = ids.every((id) => existingIdSet.has(id));
    if (!allValid) {
      return res.status(400).json({
        success: false,
        message: "One or more chapter IDs do not belong to this subject",
      });
    }

    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.chapter.update({
          where: { id },
          data: { position: index },
        })
      )
    );

    await createAuditLog({
      actorId: req.user.userId,
      action: 'REORDER_CHAPTERS',
      entityType: 'Subject',
      entityId: subjectId,
      branchId: req.user.branchId || null,
      metadata: {
        subjectId,
        count: ids.length,
        chapterIds: ids,
      },
      ip: req.ip || null,
    });

    return res.status(200).json({
      success: true,
      message: 'Chapters reordered successfully',
    });
  } catch (error) {
    console.error('Reorder chapters error:', error);
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

    if (req.user.role !== Role.SUPER_ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only SUPER_ADMIN can edit or rename chapters',
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

import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

const createChapterSchema = z.object({
  name: z.string().min(2, 'Chapter name must be at least 2 characters long'),
  subjectId: z.string().min(1, 'Subject ID is required'),
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

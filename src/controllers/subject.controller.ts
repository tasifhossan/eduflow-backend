import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

const createSubjectSchema = z.object({
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

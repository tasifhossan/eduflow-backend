import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createRoutineSlotSchema } from '../validators/routine.validator';

const prisma = new PrismaClient();

export async function createRoutineSlot(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const parseResult = createRoutineSlotSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { batchId, dayOfWeek, startTime, endTime } = parseResult.data;
    const branchId = req.user.branchId;

    // Verify batch belongs to req.user.branchId
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
        message: 'Forbidden: Batch does not belong to your branch',
      });
    }

    const newSlot = await prisma.routineSlot.create({
      data: {
        batchId,
        dayOfWeek,
        startTime,
        endTime,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Routine slot created successfully',
      data: newSlot,
    });
  } catch (error) {
    console.error('Create routine slot error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getRoutineByBatch(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const batchId = req.params.batchId as string;
    const branchId = req.user.branchId;

    // Verify batch belongs to req.user.branchId
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
        message: 'Forbidden: Batch does not belong to your branch',
      });
    }

    const slots = await prisma.routineSlot.findMany({
      where: { batchId },
      orderBy: [
        { dayOfWeek: 'asc' },
        { startTime: 'asc' },
      ],
    });

    return res.status(200).json({
      success: true,
      message: 'Routine slots retrieved successfully',
      data: slots,
    });
  } catch (error) {
    console.error('Get routine by batch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function deleteRoutineSlot(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const branchId = req.user.branchId;

    // Retrieve slot and include batch to verify branch ownership
    const slot = await prisma.routineSlot.findUnique({
      where: { id },
      include: {
        batch: true,
      },
    });

    if (!slot) {
      return res.status(404).json({
        success: false,
        message: 'Routine slot not found',
      });
    }

    if (slot.batch.branchId !== branchId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Routine slot does not belong to your branch',
      });
    }

    await prisma.routineSlot.delete({
      where: { id },
    });

    return res.status(200).json({
      success: true,
      message: 'Routine slot deleted successfully',
    });
  } catch (error) {
    console.error('Delete routine slot error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

const createBranchSchema = z.object({
  name: z.string().min(1, 'Branch name is required'),
  address: z.string().optional(),
});

const updateBranchSchema = z.object({
  name: z.string().min(1, 'Branch name cannot be empty').optional(),
  address: z.string().optional(),
});

export async function getBranches(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const where = req.effectiveBranchId ? { id: req.effectiveBranchId } : {};

    const branches = await prisma.branch.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    return res.status(200).json({
      success: true,
      message: 'Branches retrieved successfully',
      data: branches,
    });
  } catch (error) {
    console.error('Get branches error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getBranchById(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;

    if (req.effectiveBranchId && req.effectiveBranchId !== id) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied to this branch',
      });
    }

    const branch = await prisma.branch.findUnique({
      where: { id },
    });

    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Branch retrieved successfully',
      data: branch,
    });
  } catch (error) {
    console.error('Get branch by ID error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function createBranch(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const parseResult = createBranchSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { name, address } = parseResult.data;

    const branch = await prisma.branch.create({
      data: {
        name,
        address: address || null,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Branch created successfully',
      data: branch,
    });
  } catch (error) {
    console.error('Create branch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function updateBranch(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;

    const existingBranch = await prisma.branch.findUnique({
      where: { id },
    });

    if (!existingBranch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found',
      });
    }

    const parseResult = updateBranchSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { name, address } = parseResult.data;

    const updatedBranch = await prisma.branch.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(address !== undefined ? { address } : {}),
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Branch updated successfully',
      data: updatedBranch,
    });
  } catch (error) {
    console.error('Update branch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function deleteBranch(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;

    const existingBranch = await prisma.branch.findUnique({
      where: { id },
    });

    if (!existingBranch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found',
      });
    }

    await prisma.branch.delete({
      where: { id },
    });

    return res.status(200).json({
      success: true,
      message: 'Branch deleted successfully',
    });
  } catch (error) {
    console.error('Delete branch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

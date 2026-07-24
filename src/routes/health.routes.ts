import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// GET /api/health -> returns status ok and current timestamp
router.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date(),
  });
});

// GET /api/health/db -> queries the database to verify connectivity
router.get('/db', async (req: Request, res: Response) => {
  try {
    const branchCount = await prisma.branch.count();
    res.status(200).json({
      status: 'ok',
      branchCount,
    });
  } catch (error: any) {
    console.error('Database connection error during health check:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Database connection failed',
    });
  }
});

export default router;

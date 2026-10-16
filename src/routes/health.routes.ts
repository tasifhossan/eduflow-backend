import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';

const router = Router();

// GET /api/health -> returns status ok and current timestamp
router.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    status: 'ok',
    timestamp: new Date(),
  });
});

// GET /api/health/db -> queries the database to verify connectivity
router.get('/db', async (req: Request, res: Response) => {
  try {
    const branchCount = await prisma.branch.count();
    res.status(200).json({
      success: true,
      status: 'ok',
      branchCount,
    });
  } catch (error) {
    console.error('Database connection error during health check:', error);
    res.status(500).json({
      success: false,
      status: 'error',
      message: 'Database connection failed',
    });
  }
});

export default router;

import { Request, Response } from 'express';

export async function createResource(req: Request, res: Response) {
  return res.status(410).json({
    success: false,
    message: 'Resource endpoints are deprecated. Please use /api/materials.',
  });
}

export async function getResourcesByBatch(req: Request, res: Response) {
  return res.status(410).json({
    success: false,
    message: 'Resource endpoints are deprecated. Please use /api/materials.',
  });
}

export async function deleteResource(req: Request, res: Response) {
  return res.status(410).json({
    success: false,
    message: 'Resource endpoints are deprecated. Please use /api/materials.',
  });
}

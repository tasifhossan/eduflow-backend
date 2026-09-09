import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';

export function branchScope(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Authentication required',
    });
  }

  if (req.user.role === Role.SUPER_ADMIN) {
    const queryBranchId = req.query.branchId;
    if (typeof queryBranchId === 'string' && queryBranchId.trim() !== '') {
      req.effectiveBranchId = queryBranchId.trim();
    } else {
      req.effectiveBranchId = undefined;
    }
  } else {
    // Non-SUPER_ADMIN users are always restricted to their own branchId,
    // ignoring any branchId query param they try to pass.
    req.effectiveBranchId = req.user.branchId;
  }

  next();
}

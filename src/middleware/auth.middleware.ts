import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { verifyToken } from '../utils/jwt';

import prisma from '../utils/prisma';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    let token = req.cookies?.token;

    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        token = parts[1];
      }
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: No token provided',
      });
    }

    const decoded = verifyToken(token);

    // SEC-07 & Auth Lifecycle: Load user by id from DB, reject 401 if missing/inactive
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        role: true,
        branchId: true,
        isActive: true,
        mustChangePassword: true,
        passwordChangedAt: true,
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: User not found or inactive',
      });
    }

    // Invalidate tokens issued before passwordChangedAt
    if (user.passwordChangedAt && decoded.iat) {
      const tokenIatMs = decoded.iat * 1000;
      // Buffer by 1 second for clock skew
      if (tokenIatMs < user.passwordChangedAt.getTime() - 1000) {
        return res.status(401).json({
          success: false,
          code: 'SESSION_EXPIRED',
          message: 'Unauthorized: Session expired due to password change',
        });
      }
    }

    req.user = {
      userId: user.id,
      role: user.role,
      branchId: user.branchId,
      mustChangePassword: user.mustChangePassword,
    };

    // If mustChangePassword is true, block everything except:
    // GET /api/auth/me, POST /api/auth/change-password, POST /api/auth/logout
    if (user.mustChangePassword) {
      const url = req.originalUrl || req.url;
      const cleanPath = url.split('?')[0];
      const isAllowed =
        (req.method === 'GET' && cleanPath === '/api/auth/me') ||
        (req.method === 'POST' && cleanPath === '/api/auth/change-password') ||
        (req.method === 'POST' && cleanPath === '/api/auth/logout');

      if (!isAllowed) {
        return res.status(403).json({
          success: false,
          code: 'PASSWORD_CHANGE_REQUIRED',
          message: 'Password change required before accessing other resources',
        });
      }
    }

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Invalid or expired token',
    });
  }
}

export function authorize(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    if (!roles.includes(req.user.role) && req.user.role !== Role.SUPER_ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access denied',
      });
    }

    next();
  };
}

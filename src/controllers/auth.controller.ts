import { Request, Response } from 'express';
import { Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import prisma from '../utils/prisma';
import env from '../config/env';
import { signToken } from '../utils/jwt';
import { registerSchema, superAdminRegisterSchema, loginSchema } from '../validators/auth.validator';

/**
 * Sets standard authentication JWT cookie.
 */
export function setAuthCookie(res: Response, token: string): void {
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  });
}

export const googleLoginSchema = z.object({
  idToken: z.string().min(1, 'idToken is required'),
});

export const demoLoginSchema = z.object({
  role: z.enum([Role.STUDENT, Role.TEACHER, Role.ADMIN, Role.GUARDIAN]),
});

export async function register(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const isSuperAdmin = req.user.role === Role.SUPER_ADMIN;
    const schema = isSuperAdmin ? superAdminRegisterSchema : registerSchema;
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { name, email, phone, password, role } = parseResult.data;

    let branchId: string;
    if (isSuperAdmin) {
      if (!parseResult.data.branchId) {
        return res.status(400).json({
          success: false,
          message: 'Branch ID is required',
        });
      }
      branchId = parseResult.data.branchId;
      const branchExists = await prisma.branch.findUnique({
        where: { id: branchId },
      });
      if (!branchExists) {
        return res.status(400).json({
          success: false,
          message: 'The specified branch does not exist',
        });
      }
    } else {
      // Non-super-admin (ADMIN) callers: ignore body branchId and force caller's branchId
      if (!req.user.branchId) {
        return res.status(400).json({
          success: false,
          message: 'Caller has no branch assigned',
        });
      }
      branchId = req.user.branchId;
    }

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'A user with this email already exists',
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create User with explicit select to avoid returning secrets
    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        password: hashedPassword,
        role,
        branchId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        branchId: true,
        createdAt: true,
      },
    });

    // SEC-05: register must not set or change any cookie.
    return res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        user,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { email, password } = parseResult.data;

    // Find User by email
    const user = await prisma.user.findUnique({
      where: { email },
    });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Compare passwords
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Generate JWT
    const token = signToken({
      userId: user.id,
      role: user.role,
      branchId: user.branchId,
    });

    // Set JWT in cookie using shared helper
    setAuthCookie(res, token);

    const userSafe = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      branchId: user.branchId,
      createdAt: user.createdAt,
    };

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: userSafe,
        token,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function me(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        branchId: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: User no longer exists',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'User details retrieved successfully',
      data: user,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function logout(req: Request, res: Response) {
  try {
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    });
    return res.status(200).json({
      success: true,
      message: 'Logout successful',
    });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * POST /api/auth/google
 * Google login via ID token verification.
 */
export async function googleLogin(req: Request, res: Response) {
  try {
    const parseResult = googleLoginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { idToken } = parseResult.data;

    if (!env.GOOGLE_CLIENT_ID) {
      return res.status(500).json({
        success: false,
        message: 'Google login is not configured on this server',
      });
    }

    const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);
    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken,
        audience: env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Google ID token',
      });
    }

    if (!payload || !payload.email || !payload.email_verified) {
      return res.status(401).json({
        success: false,
        message: 'Google account email not verified or unavailable',
      });
    }

    const email = payload.email.toLowerCase();

    // Look up existing user by email
    let user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        branchId: true,
        createdAt: true,
      },
    });

    if (!user) {
      // Unknown email -> create a STUDENT in GOOGLE_DEFAULT_BRANCH_ID
      if (!env.GOOGLE_DEFAULT_BRANCH_ID || env.GOOGLE_DEFAULT_BRANCH_ID.trim() === '') {
        return res.status(403).json({
          success: false,
          message: 'Google registration disabled: default branch not configured',
        });
      }

      const branchExists = await prisma.branch.findUnique({
        where: { id: env.GOOGLE_DEFAULT_BRANCH_ID },
        select: { id: true },
      });

      if (!branchExists) {
        return res.status(403).json({
          success: false,
          message: 'Default branch does not exist',
        });
      }

      // Generate random unusable password
      const randomSecret = crypto.randomBytes(32).toString('hex');
      const hashedPassword = await bcrypt.hash(randomSecret, 10);

      user = await prisma.user.create({
        data: {
          name: payload.name || email.split('@')[0],
          email,
          role: Role.STUDENT,
          branchId: env.GOOGLE_DEFAULT_BRANCH_ID,
          avatarUrl: payload.picture || null,
          password: hashedPassword,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          branchId: true,
          createdAt: true,
        },
      });
    }

    const token = signToken({
      userId: user.id,
      role: user.role,
      branchId: user.branchId,
    });

    setAuthCookie(res, token);

    return res.status(200).json({
      success: true,
      message: 'Google login successful',
      data: {
        user,
        token,
      },
    });
  } catch (error) {
    console.error('Google login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * POST /api/auth/demo
 * Demo login for STUDENT, TEACHER, ADMIN, GUARDIAN (DEMO_MODE=true only).
 */
export async function demoLogin(req: Request, res: Response) {
  try {
    if (env.DEMO_MODE !== 'true') {
      return res.status(404).json({
        success: false,
        message: 'Demo mode is not enabled',
      });
    }

    const parseResult = demoLoginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed: Allowed roles are STUDENT, TEACHER, ADMIN, GUARDIAN',
        data: parseResult.error.flatten(),
      });
    }

    const { role } = parseResult.data;

    // Never allow SUPER_ADMIN
    if ((role as any) === 'SUPER_ADMIN') {
      return res.status(400).json({
        success: false,
        message: 'Demo login for SUPER_ADMIN is not permitted',
      });
    }

    const user = await prisma.user.findFirst({
      where: {
        role,
        email: `${role.toLowerCase()}@demo.eduflow.local`,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        branchId: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: `Demo user for role ${role} not found`,
      });
    }

    const token = signToken({
      userId: user.id,
      role: user.role,
      branchId: user.branchId,
    });

    setAuthCookie(res, token);

    return res.status(200).json({
      success: true,
      message: 'Demo login successful',
      data: {
        user,
        token,
      },
    });
  } catch (error) {
    console.error('Demo login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}




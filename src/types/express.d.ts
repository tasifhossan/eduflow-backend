import { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface User {
      userId: string;
      role: Role;
      branchId: string;
      mustChangePassword?: boolean;
    }

    interface Request {
      user?: User;
      effectiveBranchId?: string;
    }
  }
}

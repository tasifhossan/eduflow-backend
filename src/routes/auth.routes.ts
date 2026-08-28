import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { register, login, me, logout } from '../controllers/auth.controller';

const router = Router();

router.post('/register', authenticate, authorize(Role.ADMIN), register);

router.post('/login', login);

router.post('/logout', logout);

router.get('/me', authenticate, me);

export default router;

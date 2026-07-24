import { Router } from 'express';
import { register, login } from '../controllers/auth.controller';

const router = Router();

// TODO: Protect this endpoint with `authenticate` and `authorize('ADMIN')` in the future.
// Currently left open for initial admin registration and development ease.
router.post('/register', register);

router.post('/login', login);

export default router;

import env from './config/env';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import prisma from './utils/prisma';
import authRouter from './routes/auth.routes';
import healthRouter from './routes/health.routes';
import batchRouter from './routes/batch.routes';
import enrollmentRouter from './routes/enrollment.routes';
import routineRouter from './routes/routine.routes';
import attendanceRouter from './routes/attendance.routes';
import subjectRouter from './routes/subject.routes';
import userRouter from './routes/user.routes';
import studentRouter from './routes/student.routes';
import testRouter from './routes/test.routes';
import questionRouter from './routes/question.routes';
import submissionRouter from './routes/submission.routes';
import chapterRouter from './routes/chapter.routes';
import dashboardRouter from './routes/dashboard.routes';
import feeRouter from './routes/fee.routes';
import uploadRouter from './routes/upload.routes';
import resourceRouter from './routes/resource.routes';
import noticeRouter from './routes/notice.routes';
import guardianRouter from './routes/guardian.routes';
import branchRouter from './routes/branch.routes';
import practiceRouter from './routes/practice.routes';
import publicRouter from './routes/public.routes';
import contentRouter from './routes/content.routes';
import tablesRouter from './routes/tables.routes';
import chartsRouter from './routes/charts.routes';
import meRouter from './routes/me.routes';
import aiRouter from './routes/ai.routes';
import auditRouter from './routes/audit.routes';
import settingsRouter from './routes/settings.routes';
import { requireFeature } from './middleware/featureFlag.middleware';
import { noCache } from './middleware/noCache.middleware';

const app = express();
const PORT = env.PORT || 5000;

// Security and proxy settings
app.set('trust proxy', 1);
app.use(helmet());

// Standard Middlewares (Set up before routes)
app.use(express.json());
app.use(cookieParser());

// Rate limiters
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      message: 'Too many requests, please try again later.',
    });
  },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      message: 'Too many requests, please try again later.',
    });
  },
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      message: 'Too many registration requests, please try again later.',
    });
  },
});

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      message: 'Too many requests, please try again later.',
    });
  },
});

const demoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      message: 'Too many demo login requests, please try again later.',
    });
  },
});

app.use('/api', apiLimiter);
app.use('/api/auth', noCache);
app.post('/api/auth/login', loginLimiter);
app.post('/api/auth/register', registerLimiter);
app.post('/api/auth/demo', demoLimiter);

// SEC-02: Exact origins only, no vercel.app suffix match
const allowedOrigins = [
  env.FRONTEND_URL.replace(/\/$/, ''),
  ...(env.NODE_ENV !== 'production' ? ['http://localhost:3000'] : []),
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      
      const sanitizedOrigin = origin.replace(/\/$/, '');
      if (allowedOrigins.includes(sanitizedOrigin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  })
);

import lectureRouter from './routes/lecture.routes';
import assignmentRouter from './routes/assignment.routes';
import attachmentRouter from './routes/attachment.routes';
import notificationRouter from './routes/notification.routes';

// Routes
app.use('/api/health', healthRouter);
app.use('/api/public', publicLimiter, publicRouter);
app.use('/api/tables', tablesRouter);
app.use('/api/charts', chartsRouter);
app.use('/api/me', meRouter);
app.use('/api', contentRouter);
app.use('/api/auth', authRouter);
app.use('/api/branches', branchRouter);
app.use('/api/batches', batchRouter);
app.use('/api', enrollmentRouter);
app.use('/api', routineRouter);
app.use('/api', attendanceRouter);
app.use('/api/subjects', subjectRouter);
app.use('/api/users', userRouter);
app.use('/api', studentRouter);
app.use('/api', testRouter);
app.use('/api', questionRouter);
app.use('/api', submissionRouter);
app.use('/api/chapters', chapterRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api', feeRouter);
app.use('/api', uploadRouter);
app.use('/api', resourceRouter);
app.use('/api', noticeRouter);
app.use('/api', guardianRouter);
app.use('/api', practiceRouter);
app.use('/api/ai', requireFeature('aiAssistant'), aiRouter);
app.use('/api/audit-logs', auditRouter);
app.use('/api/settings', settingsRouter);
app.use('/api', lectureRouter);
app.use('/api', assignmentRouter);
app.use('/api', attachmentRouter);
app.use('/api', notificationRouter);


// Global Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

// Start server
app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`EduFlow Backend is running on port ${PORT}`);
});

export default app;


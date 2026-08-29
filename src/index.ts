import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
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

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Standard Middlewares (Set up before routes)
app.use(express.json());
app.use(cookieParser());

const allowedOrigins = ([
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002'
].filter(Boolean) as string[]).map((url) => url.replace(/\/$/, ''));

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) {
        return callback(null, true);
      }
      
      const sanitizedOrigin = origin.replace(/\/$/, '');
      if (
        allowedOrigins.includes(sanitizedOrigin) || 
        sanitizedOrigin.endsWith('.vercel.app')
      ) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  })
);

// Routes
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
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


// Global Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
});

// Start server
app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`EduFlow Backend is running on port ${PORT}`);
});


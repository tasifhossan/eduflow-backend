import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
  FRONTEND_URL: z.string().min(1, 'FRONTEND_URL is required'),
  GEMINI_API_KEY: z.string().optional(),
  LLM_MODEL: z
    .preprocess((val) => (val === '' || val === undefined ? 'gemini-3.5-flash-lite' : val), z.string())
    .default('gemini-3.5-flash-lite'),
  LLM_DAILY_LIMIT: z
    .preprocess((val) => (val === '' || val === undefined ? 200 : val), z.coerce.number().int().positive())
    .default(200),
  DEMO_MODE: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  for (const [key, errors] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(` - ${key}: ${errors?.join(', ')}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export default env;

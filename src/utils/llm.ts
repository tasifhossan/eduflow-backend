import { GoogleGenAI } from '@google/genai';
import Groq from 'groq-sdk';
import crypto from 'crypto';
import env from '../config/env';

export type LLMErrorCode = 'LLM_UNAVAILABLE' | 'LLM_RATE_LIMITED' | 'LLM_BLOCKED';

export class LLMError extends Error {
  readonly code: LLMErrorCode;
  readonly cause?: unknown;

  constructor(message: string, code: LLMErrorCode = 'LLM_UNAVAILABLE', cause?: unknown) {
    super(message);
    this.name = 'LLMError';
    this.code = code;
    this.cause = cause;
  }
}

export class LLMUnavailableError extends LLMError {
  constructor(message: string, cause?: unknown) {
    super(message, 'LLM_UNAVAILABLE', cause);
    this.name = 'LLMUnavailableError';
  }
}

export class LLMRateLimitedError extends LLMError {
  constructor(message: string, cause?: unknown) {
    super(message, 'LLM_RATE_LIMITED', cause);
    this.name = 'LLMRateLimitedError';
  }
}

export class LLMBlockedError extends LLMError {
  constructor(message: string, cause?: unknown) {
    super(message, 'LLM_BLOCKED', cause);
    this.name = 'LLMBlockedError';
  }
}

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CallLLMOptions {
  systemPrompt?: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  isChat?: boolean;
  task?: 'chat' | 'insights' | 'practice_explanation' | 'fast_text';
}

// ─────────────────────────────────────────────────────────────────────────────
// Banglish & Multilingual Detection Heuristics
// ─────────────────────────────────────────────────────────────────────────────
export const BANGLISH_REGEX =
  /\b(koto|keno|kivabe|korbo|bujhiye|dao|ache|achen|er|gula|gulo|hobe|parbo|ki|vai|bhai|bhaiya|apu|apni|tumi|shuru|admission|vorti|bhorti)\b/i;

export function hasBengaliOrBanglish(text: string): boolean {
  return /[\u0980-\u09FF]/.test(text) || BANGLISH_REGEX.test(text);
}

// ─────────────────────────────────────────────────────────────────────────────
// Concurrency Limiter: Serializes requests to maximum 2 concurrent calls
// ─────────────────────────────────────────────────────────────────────────────
class ConcurrencyLimiter {
  private activeCount = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number = 2) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.activeCount++;
    try {
      return await fn();
    } finally {
      this.activeCount--;
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}

const concurrencyLimiter = new ConcurrencyLimiter(2);

// ─────────────────────────────────────────────────────────────────────────────
// Daily Counter: Reset at midnight America/Los_Angeles (Gemini quota reset time)
// ─────────────────────────────────────────────────────────────────────────────
function getPacificDateString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

let currentPacificDay = getPacificDateString();
let dailyCallCount = 0;

function checkAndIncrementDailyLimit(): void {
  const today = getPacificDateString();
  if (today !== currentPacificDay) {
    currentPacificDay = today;
    dailyCallCount = 0;
  }
  const limit = env.LLM_DAILY_LIMIT ?? 200;
  if (dailyCallCount >= limit) {
    throw new LLMRateLimitedError(
      `Daily LLM quota limit (${limit}) reached. Quota resets at midnight America/Los_Angeles.`
    );
  }
  dailyCallCount++;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat In-Memory Cache: 10 minutes TTL, capped at 200 entries (evicts oldest)
// ─────────────────────────────────────────────────────────────────────────────
interface ChatCacheEntry {
  response: string;
  expiresAt: number;
}

const chatCache = new Map<string, ChatCacheEntry>();
const CHAT_CACHE_MAX_ENTRIES = 200;
const CHAT_CACHE_TTL_MS = 10 * 60 * 1000;

function getChatCacheKey(messages: LLMMessage[]): string | null {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMsg) return null;
  const normalized = lastUserMsg.content.toLowerCase().trim().replace(/\s+/g, ' ');
  const userHash = crypto.createHash('sha256').update(normalized).digest('hex');
  const lenHash = crypto.createHash('sha256').update(String(messages.length)).digest('hex');
  return `${userHash}:${lenHash}`;
}

function getFromChatCache(key: string): string | null {
  const entry = chatCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    chatCache.delete(key);
    return null;
  }
  return entry.response;
}

function setInChatCache(key: string, response: string): void {
  if (chatCache.has(key)) {
    chatCache.delete(key);
  } else if (chatCache.size >= CHAT_CACHE_MAX_ENTRIES) {
    const oldestKey = chatCache.keys().next().value;
    if (oldestKey) {
      chatCache.delete(oldestKey);
    }
  }
  chatCache.set(key, {
    response,
    expiresAt: Date.now() + CHAT_CACHE_TTL_MS,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Role Mapping & Alternation for Gemini
// ─────────────────────────────────────────────────────────────────────────────
function formatMessages(
  messages: LLMMessage[]
): Array<{ role: 'user' | 'model'; parts: [{ text: string }] }> {
  const formatted: Array<{ role: 'user' | 'model'; parts: [{ text: string }] }> = [];

  for (const msg of messages) {
    const role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
    const text = msg.content?.trim() || '';
    if (!text) continue;

    if (formatted.length > 0 && formatted[formatted.length - 1].role === role) {
      formatted[formatted.length - 1].parts[0].text += `\n\n${text}`;
    } else {
      formatted.push({
        role,
        parts: [{ text }],
      });
    }
  }

  // Ensure first message starts with 'user'
  while (formatted.length > 0 && formatted[0].role !== 'user') {
    formatted.shift();
  }

  if (formatted.length === 0) {
    throw new LLMUnavailableError('No valid user messages provided');
  }

  return formatted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Classification
// ─────────────────────────────────────────────────────────────────────────────
function classifyError(error: unknown): LLMError {
  if (error instanceof LLMError) {
    return error;
  }

  const err = error as any;
  const status = err?.status || err?.statusCode || err?.response?.status;
  const message = String(err?.message || err || '');
  const lowerMsg = message.toLowerCase();

  if (
    status === 429 ||
    err?.code === 429 ||
    err?.code === 'RESOURCE_EXHAUSTED' ||
    err?.code === 'rate_limit_exceeded' ||
    lowerMsg.includes('429') ||
    lowerMsg.includes('resource_exhausted') ||
    lowerMsg.includes('quota exceeded') ||
    lowerMsg.includes('rate limit') ||
    lowerMsg.includes('too many requests')
  ) {
    return new LLMRateLimitedError('LLM rate limit or quota exceeded', error);
  }

  if (
    lowerMsg.includes('safety') ||
    lowerMsg.includes('blocked') ||
    lowerMsg.includes('blocklist') ||
    lowerMsg.includes('prohibited')
  ) {
    return new LLMBlockedError('LLM generation blocked by safety filters', error);
  }

  if (
    err?.name === 'TimeoutError' ||
    err?.name === 'AbortError' ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('abort')
  ) {
    return new LLMUnavailableError('LLM request timed out', error);
  }

  if (
    status === 404 ||
    err?.code === 'NOT_FOUND' ||
    lowerMsg.includes('not found') ||
    lowerMsg.includes('not supported') ||
    lowerMsg.includes('is not available') ||
    lowerMsg.includes('invalid model') ||
    lowerMsg.includes('models/')
  ) {
    return new LLMUnavailableError(
      `Configured LLM model is not available or rejected by provider: ${message}`,
      error
    );
  }

  return new LLMUnavailableError(message || 'Failed to communicate with LLM provider', error);
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider Clients
// ─────────────────────────────────────────────────────────────────────────────
let stubClient: any = null;

export function setStubClient(client: any): void {
  stubClient = client;
}

function getGeminiClient(): GoogleGenAI {
  const isProduction = process.env.NODE_ENV === 'production';
  if (stubClient && !isProduction) {
    return stubClient;
  }
  if (process.env.LLM_STUB === 'true' && !isProduction) {
    return {
      models: {
        generateContent: async () => ({
          text: 'Hello from EduFlow AI assistant! Here are our available batches and schedules.',
          candidates: [{ finishReason: 'STOP' }],
        }),
      },
    } as any;
  }
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new LLMUnavailableError('GEMINI_API_KEY is not configured');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: 30000 },
  });
}

let groqClientInstance: Groq | null = null;

function getGroqClient(): Groq | null {
  const apiKey = env.GROQ_API_KEY?.trim();
  if (!apiKey) return null;
  if (!groqClientInstance) {
    groqClientInstance = new Groq({ apiKey });
  }
  return groqClientInstance;
}

// ─────────────────────────────────────────────────────────────────────────────
// Direct Provider Invocations
// ─────────────────────────────────────────────────────────────────────────────
async function callGeminiDirect(model: string, options: CallLLMOptions): Promise<string> {
  const isChat = options.isChat ?? true;
  const client = getGeminiClient();
  checkAndIncrementDailyLimit();

  const contents = formatMessages(options.messages);
  const maxOutputTokens = options.maxTokens ?? (isChat ? 600 : 800);
  const temperature = options.temperature ?? (isChat ? 0.3 : 0.2);

  const config: any = {
    abortSignal: AbortSignal.timeout(30000),
    httpOptions: { timeout: 30000 },
    maxOutputTokens,
    temperature,
  };

  if (options.systemPrompt) {
    config.systemInstruction = options.systemPrompt;
  }

  const response = await concurrencyLimiter.run(async () => {
    return await client.models.generateContent({
      model,
      contents,
      config,
    });
  });

  const candidate = response.candidates?.[0];
  const finishReason = candidate?.finishReason;

  if (
    finishReason === 'SAFETY' ||
    finishReason === 'BLOCKLIST' ||
    finishReason === 'PROHIBITED_CONTENT' ||
    finishReason === 'SPII' ||
    finishReason === 'IMAGE_SAFETY' ||
    response.promptFeedback?.blockReason
  ) {
    throw new LLMBlockedError(
      `Generation blocked by content safety filters: ${finishReason || response.promptFeedback?.blockReason || 'SAFETY'}`
    );
  }

  const text = response.text?.trim();
  if (!text) {
    if (finishReason === 'MAX_TOKENS') {
      throw new LLMUnavailableError('Model reached token limit without producing output');
    }
    throw new LLMUnavailableError('Model returned empty response');
  }

  return text;
}

async function callGroqDirect(model: string, options: CallLLMOptions): Promise<string> {
  const groq = getGroqClient();
  if (!groq) {
    throw new LLMUnavailableError('GROQ_API_KEY is not configured');
  }

  const groqMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  if (options.systemPrompt) {
    groqMessages.push({ role: 'system', content: options.systemPrompt });
  }
  for (const m of options.messages) {
    groqMessages.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    });
  }

  const completion = await groq.chat.completions.create({
    messages: groqMessages,
    model,
    max_tokens: options.maxTokens ?? (options.isChat ? 600 : 800),
    temperature: options.temperature ?? (options.isChat ? 0.3 : 0.2),
  });

  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) {
    throw new LLMUnavailableError('Groq returned empty response');
  }

  return text;
}

// ─────────────────────────────────────────────────────────────────────────────
// Router & Fallback Coordinator
// ─────────────────────────────────────────────────────────────────────────────
interface RouteTarget {
  provider: 'gemini' | 'groq';
  model: string;
}

interface RouteDecision {
  primary: RouteTarget;
  fallback?: RouteTarget;
}

function resolveRoute(options: CallLLMOptions): RouteDecision {
  const hasGroq = Boolean(env.GROQ_API_KEY?.trim());
  const geminiModel = env.LLM_MODEL || 'gemini-3.5-flash-lite';
  const groqFastModel = env.GROQ_MODEL || 'llama-3.1-8b-instant';
  const groqComplexModel = env.GROQ_COMPLEX_MODEL || 'llama-3.3-70b-versatile';

  const fullPromptText = `${options.systemPrompt || ''} ${options.messages.map((m) => m.content).join(' ')}`;
  const isBangla = hasBengaliOrBanglish(fullPromptText);

  // 1. Executive Insights: Analytical reasoning over institutional metrics
  if (options.task === 'insights') {
    if (hasGroq) {
      return {
        primary: { provider: 'groq', model: groqComplexModel },
        fallback: { provider: 'gemini', model: geminiModel },
      };
    }
    return { primary: { provider: 'gemini', model: geminiModel } };
  }

  // 2. Practice Question Explanation: Sub-second latency for students
  if (options.task === 'practice_explanation' || options.task === 'fast_text') {
    if (hasGroq && !isBangla) {
      return {
        primary: { provider: 'groq', model: groqFastModel },
        fallback: { provider: 'gemini', model: geminiModel },
      };
    }
    return {
      primary: { provider: 'gemini', model: geminiModel },
      fallback: hasGroq && !isBangla ? { provider: 'groq', model: groqFastModel } : undefined,
    };
  }

  // 3. Admissions Counselor Chat (task === 'chat' or default)
  // Bengali or Banglish queries stay strictly on Gemini (native tokenizer & comprehension)
  if (isBangla) {
    return {
      primary: { provider: 'gemini', model: geminiModel },
    };
  }

  // Clean English Admissions Chat: Gemini primary with Groq 8B fallback
  return {
    primary: { provider: 'gemini', model: geminiModel },
    fallback: hasGroq ? { provider: 'groq', model: groqFastModel } : undefined,
  };
}

/**
 * Multi-Model LLM Gateway:
 * Intelligently routes between Groq (Llama 8B / 70B) and Google Gemini (gemini-3.5-flash-lite)
 * with language/task-aware capabilities, zero-downtime fallback, and SHA-256 caching.
 */
export async function callLLM(options: CallLLMOptions): Promise<string> {
  const isChat = options.isChat ?? true;

  // 1. Check in-memory chat cache (chat only)
  let cacheKey: string | null = null;
  if (isChat) {
    cacheKey = getChatCacheKey(options.messages);
    if (cacheKey) {
      const cached = getFromChatCache(cacheKey);
      if (cached) {
        return cached;
      }
    }
  }

  // 2. Determine optimal model & fallback route
  const route = resolveRoute(options);

  // 3. Attempt Primary Provider
  try {
    let result: string;
    if (route.primary.provider === 'groq') {
      result = await callGroqDirect(route.primary.model, options);
    } else {
      result = await callGeminiDirect(route.primary.model, options);
    }

    if (isChat && cacheKey) {
      setInChatCache(cacheKey, result);
    }
    return result;
  } catch (primaryError) {
    const classified = classifyError(primaryError);

    // If no fallback route exists or error is non-recoverable safety block, rethrow
    if (!route.fallback || classified instanceof LLMBlockedError) {
      throw classified;
    }

    console.warn(
      `[LLM Router] Primary provider ${route.primary.provider} (${route.primary.model}) failed: ${classified.message}. Failing over to ${route.fallback.provider} (${route.fallback.model})...`
    );

    // 4. Execute Safe Fallback
    try {
      let fallbackResult: string;
      if (route.fallback.provider === 'groq') {
        fallbackResult = await callGroqDirect(route.fallback.model, options);
      } else {
        fallbackResult = await callGeminiDirect(route.fallback.model, options);
      }

      if (isChat && cacheKey) {
        setInChatCache(cacheKey, fallbackResult);
      }
      return fallbackResult;
    } catch (fallbackError) {
      throw classifyError(fallbackError);
    }
  }
}

// Export test helpers for unit/scratch testing
export const _testInternals = {
  checkAndIncrementDailyLimit,
  getDailyCallCount: () => dailyCallCount,
  setDailyCallCount: (count: number) => {
    dailyCallCount = count;
  },
  resetDailyCallCount: () => {
    dailyCallCount = 0;
    currentPacificDay = getPacificDateString();
  },
  chatCache,
  getFromChatCache,
  setInChatCache,
  getChatCacheKey,
  concurrencyLimiter,
  formatMessages,
  classifyError,
  resolveRoute,
  hasBengaliOrBanglish,
};

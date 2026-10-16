import Anthropic from '@anthropic-ai/sdk';
import env from '../config/env';

export class LLMError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'LLMError';
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
}

/**
 * Thin wrapper over Anthropic SDK with 15s timeout and typed error handling.
 */
export async function callLLM(options: CallLLMOptions): Promise<string> {
  const apiKey = env.LLM_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new LLMError('LLM_API_KEY is not configured');
  }

  const model = env.LLM_MODEL || 'claude-3-5-haiku-20241022';

  const client = new Anthropic({
    apiKey,
    timeout: 15000, // 15 seconds
  });

  try {
    const response = await client.messages.create({
      model,
      max_tokens: options.maxTokens ?? 1024,
      system: options.systemPrompt,
      messages: options.messages,
      temperature: options.temperature,
    });

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('\n');

    return text;
  } catch (error: any) {
    throw new LLMError(
      error?.message || 'Failed to communicate with LLM provider',
      error
    );
  }
}

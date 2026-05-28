import OpenAI from "openai";

const baseURL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
const apiKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];

let _client: OpenAI | null = null;

export class AIUnavailableError extends Error {
  readonly httpStatus = 503;
  constructor(message = "خدمة الذكاء الاصطناعي غير متاحة حالياً. حاول لاحقاً.") {
    super(message);
    this.name = "AIUnavailableError";
  }
}

export function getOpenAI(): OpenAI {
  if (_client) return _client;
  if (!baseURL || !apiKey) {
    throw new AIUnavailableError("خدمة الذكاء الاصطناعي غير مهيأة. تواصل مع مدير النظام.");
  }
  _client = new OpenAI({ apiKey, baseURL });
  return _client;
}

export const isOpenAIConfigured = (): boolean => Boolean(baseURL && apiKey);

/**
 * Wraps an AI call so transient upstream failures (timeouts, 5xx, quota
 * exhausted, parse errors) surface as a single `AIUnavailableError` the
 * route handlers can translate into a 503 with an Arabic message instead
 * of leaking stack traces or returning a generic 500. The original error
 * is still logged for ops via the `onError` hook.
 */
export async function tryAI<T>(
  fn: () => Promise<T>,
  opts: { onError?: (err: unknown) => void; message?: string } = {},
): Promise<T> {
  if (!isOpenAIConfigured()) {
    throw new AIUnavailableError(opts.message);
  }
  try {
    return await fn();
  } catch (err) {
    opts.onError?.(err);
    if (err instanceof AIUnavailableError) throw err;
    throw new AIUnavailableError(opts.message);
  }
}

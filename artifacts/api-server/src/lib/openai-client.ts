import OpenAI from "openai";

const baseURL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
const apiKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];

let _client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (_client) return _client;
  if (!baseURL || !apiKey) {
    throw new Error("OpenAI integration not configured");
  }
  _client = new OpenAI({ apiKey, baseURL });
  return _client;
}

export const isOpenAIConfigured = (): boolean => Boolean(baseURL && apiKey);

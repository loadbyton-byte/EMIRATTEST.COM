import { config } from '../config.js';

export const llmEnabled = () => !!config.llm.baseUrl;

/**
 * Chat completion against any OpenAI-compatible endpoint (Ollama, llama.cpp, vLLM, LiteLLM, Groq, OpenRouter, Hugging Face).
 * Returns the assistant text, or null when no endpoint is configured or the call fails (callers always have a non-LLM fallback).
 */
export async function llmChat(messages, { maxTokens = 500, json = false, temperature = 0.2 } = {}) {
  if (!llmEnabled()) return null;
  try {
    const body = { model: config.llm.model, messages, max_tokens: maxTokens, temperature, stream: false };
    if (json) body.response_format = { type: 'json_object' };
    const r = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(config.llm.key ? { Authorization: `Bearer ${config.llm.key}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.llm.timeoutMs),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

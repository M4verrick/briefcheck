import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { error, isError, ModelProviderError, type AnalysisError, type ErrorCode, type ModelClient, type ModelReply, type ProviderTelemetry, type SnapshotPair } from "./contracts.ts";
import { promptFor } from "./prompt.ts";
import { decodeModelCandidate, modelOutputSchema } from "./model-output.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
export const ANTHROPIC_MODEL = "claude-opus-5-5";
export type Effort = "low" | "medium" | "high";
export const ANTHROPIC_EFFORT: Effort = "medium";
const ANTHROPIC_MAX_TOKENS = 16_000;

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function failureFor(status: number): ErrorCode {
  if (status === 429) return "rate_limit";
  if (status === 413) return "capacity";
  if (status === 401 || status === 402 || status === 403) return "unavailable";
  if (status === 400 || status === 404 || status === 422) return "invalid_response";
  return "network";
}

function usageFrom(payload: JsonObject): ModelReply["usage"] {
  const usage = object(payload.usage);
  if (!usage) return undefined;
  const input = usage.prompt_tokens;
  const output = usage.completion_tokens;
  if (!Number.isInteger(input) || !Number.isInteger(output) || Number(input) < 0 || Number(output) < 0) return undefined;
  return { input_tokens: Number(input), output_tokens: Number(output) };
}

async function compare(key: string, sources: SnapshotPair, signal: AbortSignal): Promise<ModelReply> {
  const prompt = promptFor(sources);
  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "x-openrouter-title": "BriefCheck",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "briefcheck_analysis_v2", strict: true, schema: prompt.json_schema },
        },
        provider: { only: ["nvidia"], require_parameters: true, allow_fallbacks: false, max_price: { prompt: 0, completion: 0, request: 0, image: 0 } },
        max_tokens: 8192,
        temperature: 0,
        stream: false,
      }),
    });
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw new ModelProviderError("network");
  }
  let payload: JsonObject;
  try {
    const decoded: unknown = await response.json();
    const parsed = object(decoded);
    if (!parsed) throw new Error("Invalid response envelope");
    payload = parsed;
  } catch {
    throw new ModelProviderError(response.ok ? "invalid_response" : failureFor(response.status), { http_status: response.status });
  }
  const usage = usageFrom(payload);
  const cost = object(payload.usage)?.cost;
  const telemetry: ProviderTelemetry = {
    http_status: response.status,
    ...(typeof payload.id === "string" ? { request_id: payload.id } : {}),
    ...(typeof payload.model === "string" ? { returned_model: payload.model } : {}),
    ...(typeof payload.provider === "string" ? { upstream_provider: payload.provider } : {}),
    ...(typeof cost === "number" && Number.isFinite(cost) ? { cost_usd: cost } : {}),
    ...(usage ? { usage } : {}),
  };
  if (!response.ok) throw new ModelProviderError(failureFor(response.status), telemetry);
  const providerError = object(payload.error);
  if (providerError) throw new ModelProviderError(failureFor(Number(providerError.code)), telemetry);
  if (payload.model !== OPENROUTER_MODEL || (telemetry.cost_usd !== undefined && telemetry.cost_usd !== 0)) throw new ModelProviderError("unavailable", telemetry);
  const choice = Array.isArray(payload.choices) ? object(payload.choices[0]) : null;
  const message = choice ? object(choice.message) : null;
  const finishReason = choice?.finish_reason;
  if (typeof finishReason === "string") telemetry.finish_reason = finishReason;
  if (finishReason === "content_filter" || (typeof message?.refusal === "string" && message.refusal.trim())) {
    return { candidate: null, completion: "refused", telemetry, ...(usage ? { usage } : {}) };
  }
  if (finishReason === "length") return { candidate: null, completion: "truncated", telemetry, ...(usage ? { usage } : {}) };
  if (finishReason !== "stop" || typeof message?.content !== "string") throw new ModelProviderError("invalid_response", telemetry);

  let wire_candidate: unknown;
  try { wire_candidate = JSON.parse(message.content); }
  catch { throw new ModelProviderError("invalid_response", telemetry); }
  const decoded = decodeModelCandidate(wire_candidate, sources);
  return { candidate: isError(decoded) ? null : decoded, wire_candidate, ...(isError(decoded) ? { validation_error: decoded } : {}), completion: "complete", telemetry, ...(usage ? { usage } : {}) };
}

export function openRouterClient(key: string): ModelClient {
  return { provider: "openrouter", model: OPENROUTER_MODEL, compare: (sources, signal) => compare(key, sources, signal) };
}

// Anthropic path: one pinned model, structured output, no retries and no
// refusal fallback, so provenance names the single model that answered.
async function compareAnthropic(anthropic: Anthropic, effort: Effort, sources: SnapshotPair, signal: AbortSignal): Promise<ModelReply> {
  const prompt = promptFor(sources);
  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: ANTHROPIC_MODEL, max_tokens: ANTHROPIC_MAX_TOKENS, system: prompt.system,
      output_config: { effort, format: zodOutputFormat(modelOutputSchema) },
      messages: [{ role: "user", content: prompt.user }],
    }, { signal });
  } catch (cause) {
    if (signal.aborted) throw cause;
    if (cause instanceof Anthropic.RateLimitError) throw new ModelProviderError("rate_limit", { http_status: 429 });
    if (cause instanceof Anthropic.AuthenticationError || cause instanceof Anthropic.PermissionDeniedError) throw new ModelProviderError("unavailable", { http_status: cause.status });
    if (cause instanceof Anthropic.APIError) throw new ModelProviderError(cause.status && cause.status >= 500 ? "network" : "invalid_response", { http_status: cause.status ?? 0 });
    throw new ModelProviderError("network");
  }
  const usage = { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens };
  const telemetry: ProviderTelemetry = { http_status: 200, request_id: response.id, returned_model: response.model, upstream_provider: "anthropic", ...(response.stop_reason ? { finish_reason: response.stop_reason } : {}), usage };
  if (response.model !== ANTHROPIC_MODEL) throw new ModelProviderError("unavailable", telemetry);
  if (response.stop_reason === "refusal") return { candidate: null, completion: "refused", usage, telemetry };
  if (response.stop_reason === "max_tokens") return { candidate: null, completion: "truncated", usage, telemetry };
  if (response.stop_reason !== "end_turn") throw new ModelProviderError("invalid_response", telemetry);
  let wire_candidate: unknown;
  try { wire_candidate = JSON.parse(response.content.flatMap((b) => b.type === "text" ? [b.text] : []).join("")); }
  catch { throw new ModelProviderError("invalid_response", telemetry); }
  const decoded = decodeModelCandidate(wire_candidate, sources);
  return { candidate: isError(decoded) ? null : decoded, wire_candidate, ...(isError(decoded) ? { validation_error: decoded } : {}), completion: "complete", usage, telemetry };
}

export function anthropicClient(key: string, effort: Effort = ANTHROPIC_EFFORT, workspace?: string): ModelClient {
  // An organization-level key must name the workspace on every request.
  const anthropic = new Anthropic({ apiKey: key, maxRetries: 0, ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}) });
  return { provider: "anthropic", model: ANTHROPIC_MODEL, compare: (sources, signal) => compareAnthropic(anthropic, effort, sources, signal) };
}

// The app prefers the paid Anthropic model when its key is present and falls
// back to the authorized free OpenRouter endpoint otherwise.
export function configuredClient(): ModelClient | AnalysisError {
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) return anthropicClient(anthropicKey, ANTHROPIC_EFFORT, process.env.ANTHROPIC_WORKSPACE_ID?.trim() || undefined);
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) return error("unavailable");
  return openRouterClient(key);
}

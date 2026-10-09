import "server-only";
import { ModelProviderError } from "../lib/contracts.ts";
import { OPENROUTER_MODEL } from "../lib/provider.ts";

type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue | null { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : null; }
export async function freeReadiness(key: string, checkPricing = true) {
  const accountResponse = await fetch("https://openrouter.ai/api/v1/key", { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
  if (!accountResponse.ok) throw new ModelProviderError("unavailable");
  const account = object(object(await accountResponse.json())?.data);
  const quota = object(account?.free_model_daily_requests);
  if (!quota || ![quota.used, quota.limit, quota.remaining].every(v => typeof v === "number" && Number.isInteger(v) && v >= 0)) throw new ModelProviderError("unavailable");
  const free_requests = { used: Number(quota.used), limit: Number(quota.limit), remaining: Number(quota.remaining) };
  const endpoints: RecordValue[] = [];
  if (checkPricing) {
    const response = await fetch(`https://openrouter.ai/api/v1/models/${OPENROUTER_MODEL}/endpoints`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new ModelProviderError("unavailable");
    const data = object(object(await response.json())?.data);
    const all = Array.isArray(data?.endpoints) ? data.endpoints : [];
    for (const item of all) {
      const endpoint = object(item);
      if (!endpoint || endpoint.tag !== "nvidia") continue;
      const pricing = object(endpoint.pricing);
      const supported = Array.isArray(endpoint.supported_parameters) ? endpoint.supported_parameters : [];
      if (!pricing || !Object.keys(pricing).length || !Object.values(pricing).every(v => Number.isFinite(Number(v)) && Number(v) === 0) || !supported.includes("response_format") || !supported.includes("max_tokens")) throw new ModelProviderError("unavailable");
      endpoints.push({ tag: endpoint.tag, provider_name: endpoint.provider_name, pricing, context_length: endpoint.context_length, supported_parameters: supported });
    }
    if (!endpoints.length) throw new ModelProviderError("unavailable");
  }
  return { checked_at: new Date().toISOString(), model: OPENROUTER_MODEL, free_requests, monetary_usage_usd: typeof account?.usage === "number" ? account.usage : null, monetary_usage_daily_usd: typeof account?.usage_daily === "number" ? account.usage_daily : null, ...(checkPricing ? { verified_zero_price_endpoints: endpoints } : {}) };
}

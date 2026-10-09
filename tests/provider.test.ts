import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isError } from "../lib/contracts";
import { configuredClient } from "../lib/provider";
import { analyze } from "../lib/analysis";
import { makeSnapshot } from "../lib/evidence";

import { ANTHROPIC_MODEL } from "../lib/provider";

beforeEach(() => { vi.stubEnv("ANTHROPIC_API_KEY", ""); vi.stubEnv("ANTHROPIC_WORKSPACE_ID", ""); });
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("OpenRouter provider", () => {
  it.each([[429, "rate_limit"], [413, "capacity"], [401, "unavailable"], [402, "unavailable"], [403, "unavailable"], [503, "network"], [400, "invalid_response"]])("maps HTTP %s safely without retry", async (status, code) => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "PRIVATE_RAW_PROVIDER_DETAIL" } }), { status: Number(status) }));
    vi.stubGlobal("fetch", fetchMock);
    const client = configuredClient(); if (isError(client)) throw new Error("Test setup failed");
    const result = await analyze({ brief: "Booking required.", scope: "Email signup." }, client, new AbortController().signal);
    expect(result).toMatchObject({ code }); expect(JSON.stringify(result)).not.toContain("PRIVATE_RAW_PROVIDER_DETAIL"); expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["different-model", "nonzero-cost", "broken-json", "length", "content_filter"])("rejects %s completion safely", async (scenario) => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const payload = { id: "synthetic-request", model: scenario === "different-model" ? "paid/model" : "nvidia/nemotron-3-super-120b-a12b:free", usage: { prompt_tokens: 1, completion_tokens: 2, cost: scenario === "nonzero-cost" ? 0.001 : 0 }, choices: [{ finish_reason: ["length", "content_filter"].includes(scenario) ? scenario : "stop", message: { content: scenario === "broken-json" ? "{broken" : JSON.stringify({ schema_version: 1, status: "complete", findings: [], comparison_evidence: [] }) } }] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    const client = configuredClient(); if (isError(client)) throw new Error("Test setup failed");
    const result = await analyze({ brief: "Booking required.", scope: "Email signup." }, client, new AbortController().signal);
    expect(result).toMatchObject({ code: ["different-model", "nonzero-cost"].includes(scenario) ? "unavailable" : scenario === "content_filter" ? "refused" : "invalid_response" }); expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retains actual request identity, token usage and zero cost for the evaluator", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "synthetic-id", model: "nvidia/nemotron-3-super-120b-a12b:free", provider: "Nvidia", usage: { prompt_tokens: 12, completion_tokens: 4, cost: 0 }, choices: [{ finish_reason: "stop", message: { content: "{}" } }] }), { status: 200 })));
    const client = configuredClient(); if (isError(client)) throw new Error("Test setup failed");
    const sources = await makeSnapshot({ brief: "A", scope: "B" });
    expect((await client.compare(sources, new AbortController().signal)).telemetry).toMatchObject({ request_id: "synthetic-id", returned_model: client.model, upstream_provider: "Nvidia", cost_usd: 0, usage: { input_tokens: 12, output_tokens: 4 }, finish_reason: "stop" });
  });
  it("fails closed when no server-side key is configured", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(configuredClient()).toMatchObject({ code: "unavailable" });
  });

  it("pins the free model and requests schema-constrained JSON without fallbacks", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "test-request", model: "nvidia/nemotron-3-super-120b-a12b:free", provider: "Nvidia",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ schema_version: 2, status: "complete", findings: [], comparison_evidence: [] }) } }],
      usage: { prompt_tokens: 123, completion_tokens: 45 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = configuredClient();
    expect(isError(client)).toBe(false);
    if (isError(client)) return;
    const sources = {
      project_title: "",
      identity: "snapshot",
      brief: { id: "brief" as const, text: "Booking required.", sha256: "brief-hash", lines: [{ number: 1, start: 0, end: 17 }] },
      scope: { id: "scope" as const, text: "Email signup.", sha256: "scope-hash", lines: [{ number: 1, start: 0, end: 13 }] },
    };
    const reply = await client.compare(sources, new AbortController().signal);

    expect(client).toMatchObject({ provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free" });
    expect(reply).toMatchObject({ completion: "complete", usage: { input_tokens: 123, output_tokens: 45 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-only-key");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "nvidia/nemotron-3-super-120b-a12b:free",
      stream: false,
      provider: { only: ["nvidia"], require_parameters: true, allow_fallbacks: false, max_price: { prompt: 0, completion: 0, request: 0, image: 0 } },
      max_tokens: 8192,
      response_format: { type: "json_schema", json_schema: { name: "briefcheck_analysis_v2", strict: true } },
    });
    expect(body.models).toBeUndefined();
    expect(body.tools).toBeUndefined();
  });
});

describe("Anthropic provider", () => {
  const input = { brief: "Booking required.", scope: "Email signup." };
  const message = (overrides: Record<string, unknown> = {}) => new Response(JSON.stringify({ id: "msg_synthetic", type: "message", role: "assistant", model: ANTHROPIC_MODEL, stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 40, output_tokens: 9 }, content: [{ type: "text", text: JSON.stringify({ schema_version: 2, status: "complete", findings: [], comparison_evidence: [] }) }], ...overrides }), { status: 200, headers: { "content-type": "application/json" } });

  it("prefers the Anthropic key over the free endpoint and fails closed without either", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-only-key"); vi.stubEnv("OPENROUTER_API_KEY", "other-test-key");
    expect(configuredClient()).toMatchObject({ provider: "anthropic", model: ANTHROPIC_MODEL });
    vi.stubEnv("ANTHROPIC_API_KEY", ""); vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(configuredClient()).toMatchObject({ code: "unavailable" });
  });

  it("sends one pinned structured-output request with no tools, sampling or retries", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-only-key"); vi.stubEnv("ANTHROPIC_WORKSPACE_ID", "wrkspc_test");
    const fetchMock = vi.fn().mockResolvedValue(message()); vi.stubGlobal("fetch", fetchMock);
    const client = configuredClient(); if (isError(client)) throw new Error("Test setup failed");
    const result = await analyze(input, client, new AbortController().signal);
    expect(result).toMatchObject({ status: "complete", usage: { input_tokens: 40, output_tokens: 9 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    const headers = new Headers(init.headers);
    expect(headers.get("x-api-key")).toBe("test-only-key"); expect(headers.get("anthropic-workspace-id")).toBe("wrkspc_test");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: ANTHROPIC_MODEL, max_tokens: 16000, output_config: { effort: "medium", format: { type: "json_schema" } } });
    expect(body.messages).toHaveLength(1); expect(body.system).toContain("TRUST BOUNDARY");
    for (const absent of ["tools", "temperature", "top_p", "fallbacks", "stream"]) expect(body[absent]).toBeUndefined();
  });

  it.each([[429, "rate_limit"], [401, "unavailable"], [403, "unavailable"], [400, "invalid_response"], [529, "network"]])("maps HTTP %s safely without retry", async (status, code) => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-only-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ type: "error", error: { type: "synthetic", message: "PRIVATE_RAW_PROVIDER_DETAIL" } }), { status: Number(status), headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = configuredClient(); if (isError(client)) throw new Error("Test setup failed");
    const result = await analyze(input, client, new AbortController().signal);
    expect(result).toMatchObject({ code }); expect(JSON.stringify(result)).not.toContain("PRIVATE_RAW_PROVIDER_DETAIL"); expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([["refusal", "refused"], ["max_tokens", "invalid_response"], ["different-model", "unavailable"], ["broken-json", "invalid_response"]])("rejects %s completion safely", async (scenario, code) => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-only-key");
    const overrides = scenario === "different-model" ? { model: "claude-other" } : scenario === "broken-json" ? { content: [{ type: "text", text: "{broken" }] } : { stop_reason: scenario };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(message(overrides)));
    const client = configuredClient(); if (isError(client)) throw new Error("Test setup failed");
    expect(await analyze(input, client, new AbortController().signal)).toMatchObject({ code });
  });

  it("retains request identity, returned model and usage for the evaluator", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-only-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(message()));
    const client = configuredClient(); if (isError(client)) throw new Error("Test setup failed");
    const reply = await client.compare(await makeSnapshot({ brief: "A", scope: "B" }), new AbortController().signal);
    expect(reply.telemetry).toMatchObject({ request_id: "msg_synthetic", returned_model: ANTHROPIC_MODEL, upstream_provider: "anthropic", finish_reason: "end_turn", usage: { input_tokens: 40, output_tokens: 9 } });
    expect(reply.telemetry?.cost_usd).toBeUndefined();
  });
});

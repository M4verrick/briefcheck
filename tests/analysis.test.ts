import { afterEach, describe, expect, it, vi } from "vitest";
import { analyze } from "../lib/analysis";
import { isError, ModelProviderError, type ModelClient, type ModelReply } from "../lib/contracts";
const input = { brief: "Launch on 20 October.", scope: "Launch on 27 October." };
const candidate = { schema_version: 1, status: "complete", comparison_evidence: [], findings: [{ kind: "conflict", title: "Launch dates", rationale: "Same milestone, different dates.", question: "Which date is agreed?", evidence: [{ source_id: "brief", start_line: 1, end_line: 1, quote: input.brief }, { source_id: "scope", start_line: 1, end_line: 1, quote: input.scope }] }] };
function client(reply: Partial<ModelReply> = {}): ModelClient { return { provider: "test-only", model: "synthetic-boundary", compare: vi.fn().mockResolvedValue({ completion: "complete", candidate, ...reply }) }; }
afterEach(() => vi.useRealTimers());
describe("single analysis boundary", () => {
  it("calls once, validates evidence and owns IDs/provenance", async () => {
    const c = client(); const result = await analyze(input, c, new AbortController().signal);
    expect(c.compare).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ origin: "model" }); expect(result).not.toHaveProperty("provider"); expect(result).not.toHaveProperty("model");
    if (!isError(result)) { expect(result.analysis_id).toBeTruthy(); expect(result.findings[0].id).toBeTruthy(); expect(result.findings[0].evidence[0]).toMatchObject({ start_offset: 0, end_offset: 21 }); expect(result.snapshot_id).toBe(result.sources.identity); expect(Date.parse(result.analyzed_at)).not.toBeNaN(); }
  });
  it("invalid input never calls the model", async () => { const c = client(); expect(await analyze({ brief: " ", scope: "x" }, c, new AbortController().signal)).toMatchObject({ code: "invalid_input" }); expect(c.compare).not.toHaveBeenCalled(); });
  it.each(["refused", "truncated"] as const)("rejects unfinished %s results", async (completion) => { expect(await analyze(input, client({ completion }), new AbortController().signal)).toMatchObject({ code: completion === "refused" ? "refused" : "invalid_response" }); });
  it("rejects one invented quote instead of showing fewer findings", async () => { const bad = structuredClone(candidate); bad.findings[0].evidence[0].quote = "Invented"; expect(await analyze(input, client({ candidate: bad }), new AbortController().signal)).toMatchObject({ code: "invalid_evidence" }); });
  it("does not leak provider errors or automatically retry", async () => { const c = client(); vi.mocked(c.compare).mockRejectedValue(new Error("secret-token raw-client-data")); const result = await analyze(input, c, new AbortController().signal); expect(result).toMatchObject({ code: "network" }); expect(JSON.stringify(result)).not.toContain("secret-token"); expect(c.compare).toHaveBeenCalledTimes(1); });
  it("preserves safe provider error categories without leaking details", async () => { const c = client(); vi.mocked(c.compare).mockRejectedValue(new ModelProviderError("rate_limit")); expect(await analyze(input, c, new AbortController().signal)).toMatchObject({ code: "rate_limit" }); expect(c.compare).toHaveBeenCalledTimes(1); });
  it("already cancelled attempts call no model", async () => { const a = new AbortController(); a.abort(); const c = client(); expect(await analyze(input, c, a.signal)).toMatchObject({ code: "cancelled" }); expect(c.compare).not.toHaveBeenCalled(); });
  it("cancels even a client that ignores abort, without accepting its late result", async () => { const a = new AbortController(); const c = client(); vi.mocked(c.compare).mockImplementation(() => new Promise(() => {})); const pending = analyze(input, c, a.signal); await vi.waitFor(() => expect(c.compare).toHaveBeenCalledTimes(1)); a.abort(); expect(await pending).toMatchObject({ code: "cancelled" }); });
  it("times out at 60 seconds with no retry", async () => { vi.useFakeTimers(); const c = client(); vi.mocked(c.compare).mockImplementation(() => new Promise(() => {})); const pending = analyze(input, c, new AbortController().signal); await vi.waitFor(() => expect(c.compare).toHaveBeenCalledTimes(1)); await vi.advanceTimersByTimeAsync(60_000); expect(await pending).toMatchObject({ code: "timeout" }); expect(c.compare).toHaveBeenCalledTimes(1); });
});

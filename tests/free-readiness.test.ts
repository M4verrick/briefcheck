import { afterEach, describe, expect, it, vi } from "vitest";
import { freeReadiness } from "../eval/free-readiness";
const account = { data: { usage: 0, usage_daily: 0, label: "PRIVATE_ACCOUNT_LABEL", free_model_daily_requests: { used: 1, limit: 50, remaining: 49 } } };
const endpoint = { tag: "nvidia", provider_name: "Nvidia", pricing: { prompt: "0", completion: "0" }, supported_parameters: ["response_format", "max_tokens"] };
afterEach(() => vi.unstubAllGlobals());
describe("free-only evaluation readiness", () => {
  it("records free quota and zero endpoint pricing without private account identifiers", async () => {
    const mocked = vi.fn().mockResolvedValueOnce(Response.json(account)).mockResolvedValueOnce(Response.json({ data: { endpoints: [endpoint] } })); vi.stubGlobal("fetch", mocked);
    const receipt = await freeReadiness("test-key");
    expect(receipt.free_requests).toEqual({ used: 1, limit: 50, remaining: 49 }); expect(receipt.verified_zero_price_endpoints).toHaveLength(1); expect(JSON.stringify(receipt)).not.toContain("PRIVATE_ACCOUNT_LABEL"); expect(JSON.stringify(receipt)).not.toContain("test-key");
    expect(new Headers(mocked.mock.calls[0][1].headers).get("authorization")).toBe("Bearer test-key"); expect(mocked.mock.calls[1][1].headers).toBeUndefined();
  });
  it.each(["missing-quota", "invalid-quota", "priced", "wrong-provider", "unsupported-schema", "lookup-failure"])("refuses %s readiness before any inference", async (scenario) => {
    const changedAccount = structuredClone(account); const changedEndpoint = structuredClone(endpoint);
    if (scenario === "missing-quota") delete (changedAccount.data as Partial<typeof changedAccount.data>).free_model_daily_requests;
    if (scenario === "invalid-quota") changedAccount.data.free_model_daily_requests.remaining = -1;
    if (scenario === "priced") changedEndpoint.pricing.completion = "0.0001";
    if (scenario === "wrong-provider") changedEndpoint.tag = "another-provider";
    if (scenario === "unsupported-schema") changedEndpoint.supported_parameters = ["max_tokens"];
    const mocked = vi.fn().mockResolvedValueOnce(Response.json(changedAccount, { status: scenario === "lookup-failure" ? 403 : 200 })).mockResolvedValueOnce(Response.json({ data: { endpoints: [changedEndpoint] } })); vi.stubGlobal("fetch", mocked);
    await expect(freeReadiness("test-key")).rejects.toMatchObject({ code: "unavailable" });
    expect(mocked.mock.calls.every(call => !String(call[0]).includes("chat/completions"))).toBe(true);
  });
});

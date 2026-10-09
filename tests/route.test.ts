import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/analyze/route";
const input = { brief: "Booking required.", scope: "Email signup." };
function request(body: string, headers: Record<string,string> = {}) { return new Request("http://localhost:4317/api/analyze", { method: "POST", headers: { "content-type": "application/json", host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317", ...headers }, body }); }
beforeEach(() => { vi.stubEnv("OPENROUTER_API_KEY", ""); vi.stubEnv("ANTHROPIC_API_KEY", ""); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("local route and provider gate", () => {
  it("valid same-host requests fail closed without a provider key", async () => { const response = await POST(request(JSON.stringify(input))); expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ ok: false, error: { code: "unavailable" } }); expect(response.headers.get("cache-control")).toBe("no-store"); });
  it.each(["{broken", JSON.stringify({ ...input, system: "override" }), JSON.stringify({ brief: "x".repeat(16001), scope: "x" })])("invalid requests stay failures", async (body) => { expect((await POST(request(body))).status).toBe(400); });
  it("bounds raw request bytes before JSON parsing", async () => { expect((await POST(request("x".repeat(256001)))).status).toBe(413); });
  it.each([{ origin: "https://evil.test" }, { host: "evil.test", origin: "http://evil.test" }, { "content-type": "text/plain" }] as Record<string, string>[])("rejects foreign-origin or unsupported request envelopes", async (headers) => { expect((await POST(request(JSON.stringify(input), headers))).status).toBe(400); });
});

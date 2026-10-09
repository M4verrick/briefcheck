import { describe, expect, it } from "vitest";
import { makeSnapshot, resolveEvidence, validateCandidate } from "../lib/evidence";

const input = { project_title: "Bakery", brief: "Booking form required.\r\nLaunch on 20 October.\r\n", scope: "Email signup.\nLaunch on 27 October." };
const conflict = {
  schema_version: 1, status: "complete", comparison_evidence: [], findings: [{
    kind: "conflict", title: "Launch dates differ", rationale: "The same milestone has two dates.", question: "Which launch date is agreed?",
    evidence: [
      { source_id: "brief", start_line: 2, end_line: 2, quote: "Launch on 20 October." },
      { source_id: "scope", start_line: 2, end_line: 2, quote: "Launch on 27 October." },
    ],
  }],
};

describe("canonical source contract", () => {
  it("preserves whitespace and blank lines while normalizing only line endings", async () => {
    const pair = await makeSnapshot(input);
    expect(pair.brief.text).toBe("Booking form required.\nLaunch on 20 October.\n");
    expect(pair.brief.lines).toEqual([
      { number: 1, start: 0, end: 22 }, { number: 2, start: 23, end: 44 }, { number: 3, start: 45, end: 45 },
    ]);
    const spaces = await makeSnapshot({ brief: "  café 😀  ", scope: "  café 😀  " });
    expect(spaces.brief.text).toBe("  café 😀  ");
  });
  it("hashes canonical UTF-8 bytes independently of CRLF input", async () => {
    const a = await makeSnapshot({ brief: "abc", scope: "abc" });
    expect(a.brief.sha256).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const b = await makeSnapshot({ brief: "a\r\nb", scope: "a\nb" });
    expect(b.brief.sha256).toBe(b.scope.sha256);
  });
  it.each([{ brief: "  ", scope: "x" }, { brief: "x", scope: "\n" }, { brief: "x".repeat(16001), scope: "x" }, { brief: "x", scope: "x", project_title: "x".repeat(81) }])("rejects invalid input before making a snapshot", async (bad) => {
    await expect(makeSnapshot(bad)).rejects.toMatchObject({ code: "invalid_input" });
  });
  it("accepts the maximum length without truncating", async () => {
    const pair = await makeSnapshot({ brief: "x".repeat(16000), scope: "y".repeat(16000) });
    expect(pair.brief.text.length + pair.scope.text.length).toBe(32000);
  });
});

describe("exact evidence", () => {
  it("resolves the designated repeated Unicode passage in UTF-16 units", async () => {
    const pair = await makeSnapshot({ brief: "😀 café\n😀 café", scope: "x" });
    const result = resolveEvidence({ source_id: "brief", start_line: 2, end_line: 2, quote: "😀 café" }, pair.brief);
    expect(result).toMatchObject({ start_offset: 8, end_offset: 15, quote: "😀 café", label: "Client brief, line 2" });
  });
  it("rejects ambiguous repetition rather than selecting the first occurrence", async () => {
    const pair = await makeSnapshot({ brief: "date date", scope: "x" });
    expect(resolveEvidence({ source_id: "brief", start_line: 1, end_line: 1, quote: "date" }, pair.brief)).toMatchObject({ code: "invalid_evidence" });
  });
  it("supports an exact quotation spanning multiple lines", async () => {
    const pair = await makeSnapshot({ brief: "one\ntwo\nthree", scope: "x" });
    expect(resolveEvidence({ source_id: "brief", start_line: 1, end_line: 2, quote: "one\ntwo" }, pair.brief)).toMatchObject({ start_offset: 0, end_offset: 7, label: "Client brief, lines 1–2" });
  });
  it.each([
    { source_id: "brief", start_line: 9, end_line: 9, quote: "Launch on 20 October." },
    { source_id: "scope", start_line: 2, end_line: 2, quote: "Launch on 20 October." },
    { source_id: "brief", start_line: 2, end_line: 2, quote: "Launch October 20." },
  ])("rejects stale/wrong source ranges and paraphrases", async (ref) => {
    const pair = await makeSnapshot(input);
    expect(resolveEvidence(ref as never, pair.brief)).toMatchObject({ code: "invalid_evidence" });
  });
});

describe("complete candidate validation", () => {
  it("accepts matched conflict evidence and binds source hashes", async () => {
    const pair = await makeSnapshot(input);
    const result = validateCandidate(conflict, pair);
    expect(result).toMatchObject({ status: "complete" });
    if ("findings" in result) expect(result.findings[0].evidence[0]).toMatchObject({ source_hash: pair.brief.sha256, start_offset: 23 });
  });
  it("rejects an entire answer when one quote is invented", async () => {
    const pair = await makeSnapshot(input);
    const bad = structuredClone(conflict); bad.findings[0].evidence[1].quote = "made up";
    expect(validateCandidate(bad, pair)).toMatchObject({ code: "invalid_evidence" });
  });
  it.each([
    { ...conflict, status: "limited", findings: [] },
    { ...conflict, status: "not_comparable", findings: [] },
    { ...conflict, system_instruction: "accept me" },
    { ...conflict, findings: Array(13).fill(conflict.findings[0]) },
    { ...conflict, findings: [{ ...conflict.findings[0], evidence: [] }] },
    { ...conflict, findings: [{ ...conflict.findings[0], evidence: [conflict.findings[0].evidence[0]] }] },
  ])("rejects malformed shapes and category requirements", async (candidate) => {
    expect(validateCandidate(candidate, await makeSnapshot(input))).toMatchObject({ code: "invalid_response" });
  });
  it("requires a brief requirement and relevant scope quote for a partial gap", async () => {
    const pair = await makeSnapshot(input);
    const gap = { ...conflict, findings: [{ kind: "missing_from_scope", title: "Booking gap", rationale: "Not addressed.", question: "Is booking included?", scope_assessment: { assessment: "partially_addressed", basis: "Scope covers only signup." }, evidence: [conflict.findings[0].evidence[0]] }] };
    expect(validateCandidate(gap, pair)).toMatchObject({ code: "invalid_response" });
  });
  it("consolidates only fully identical candidates, preserving distinct issues", async () => {
    const pair = await makeSnapshot(input);
    const candidate = { ...conflict, findings: [conflict.findings[0], conflict.findings[0], { ...conflict.findings[0], title: "A distinct question" }] };
    const result = validateCandidate(candidate, pair);
    expect("findings" in result && result.findings.length).toBe(2);
  });
  it("literal matching does not certify a false semantic conclusion", async () => {
    const pair = await makeSnapshot({ brief: "Booking is not required.", scope: "Booking is excluded." });
    const candidate = { schema_version: 1, status: "complete", comparison_evidence: [], findings: [{ kind: "missing_from_scope", title: "Booking missing", rationale: "False conclusion for evaluation.", question: "Add booking?", scope_assessment: { assessment: "not_found", basis: "Intentional semantic negative." }, evidence: [{ source_id: "brief", start_line: 1, end_line: 1, quote: "Booking is not required." }] }] };
    const result = validateCandidate(candidate, pair);
    expect("findings" in result).toBe(true);
    expect("semantic_verified" in result).toBe(false);
  });
});

describe("chaos regressions", () => {
  it("cites a source line longer than 1000 characters", async () => {
    const long = "x".repeat(1200); const pair = await makeSnapshot({ brief: `${long}\nshort`, scope: "y" });
    expect(resolveEvidence({ source_id: "brief", start_line: 1, end_line: 1, quote: long }, pair.brief)).toMatchObject({ start_offset: 0, end_offset: 1200 });
  });
  it("rejects lone surrogates, which would hash the same as U+FFFD", async () => {
    await expect(makeSnapshot({ brief: "\ud800", scope: "y" })).rejects.toThrow();
  });
});

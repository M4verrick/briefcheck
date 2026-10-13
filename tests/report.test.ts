import { describe, expect, it } from "vitest";
import { fixtureAnalysis } from "./fixtures";
import { buildReport, toMarkdown } from "../lib/report";
import type { ReviewRecord } from "../lib/contracts";
async function reportFixture() { const analysis = await fixtureAnalysis(); return { analysis, reviews: [{ finding_id: analysis.findings[0].id, disposition: "open", note: "Awaiting client date answer" }] as ReviewRecord[] }; }
describe("frozen deterministic report", () => {
  it("places Open decisions first and keeps the outstanding answer note Open", async () => { const { analysis, reviews } = await reportFixture(); const doc = buildReport(analysis, reviews, { include_dismissed: false, review_revision: 3 }); const md = toMarkdown(doc); expect(doc.draft).toBe(true); expect(doc.options.review_revision).toBe(3); expect(md).toContain("Decisions still needed"); expect(md).toContain("Awaiting client date answer"); expect(md.indexOf("## Decisions still needed")).toBeLessThan(md.indexOf("## Decisions recorded")); expect(md).toContain("Original documents are unchanged"); expect(md).toContain("Sample data — illustrative findings written by hand."); });
  it("excludes dismissed by default and explicitly counts zero included or omitted", async () => { const { analysis, reviews } = await reportFixture(); reviews[0].disposition = "dismissed"; reviews[0].note = "User says out of phase"; const hidden = buildReport(analysis, reviews, { include_dismissed: false, review_revision: 1 }); expect(hidden.counts).toMatchObject({ all: 1, included: 0, omitted: 1 }); expect(toMarkdown(hidden)).not.toContain("User says out of phase"); const shown = buildReport(analysis, reviews, { include_dismissed: true, review_revision: 1 }); expect(shown.counts).toMatchObject({ all: 1, included: 1, omitted: 0 }); expect(toMarkdown(shown)).toContain("User says out of phase"); });
  it("labels recorded outcomes user-reported, not verified client assent", async () => { const { analysis, reviews } = await reportFixture(); reviews[0].disposition = "decision_recorded"; reviews[0].note = "User reports booking details agreed"; const md = toMarkdown(buildReport(analysis, reviews, { include_dismissed: false, review_revision: 1 })); expect(md).toContain("User reports booking details agreed"); expect(md).toContain("client assent is unverified"); expect(md).not.toContain("ready to sign"); });
  it("keeps limited warnings and exact Unicode/multiline quoted content", async () => { const { analysis, reviews } = await reportFixture(); analysis.status = "limited"; analysis.findings[0].evidence[0].quote = "😀 café\nline two"; const md = toMarkdown(buildReport(analysis, reviews, { include_dismissed: false, review_revision: 1 })); expect(md).toContain("Additional issues may exist"); expect(md).toContain("😀 café\nline two"); expect(md).toContain("Client brief, line 1"); });
  it("freezes review data independently of later edits", async () => { const { analysis, reviews } = await reportFixture(); const doc = buildReport(analysis, reviews, { include_dismissed: false, review_revision: 4 }); reviews[0].note = "Later edit"; analysis.findings[0].title = "Later title"; expect(toMarkdown(doc)).not.toContain("Later edit"); expect(toMarkdown(doc)).not.toContain("Later title"); expect(Object.isFrozen(doc)).toBe(true); });
  it("makes source scripts, links, images and fences inert in Markdown", async () => { const { analysis, reviews } = await reportFixture(); reviews[0].note = '<script>alert(1)</script>\n![remote](https://evil.test/a)\n```\n# hijack'; const md = toMarkdown(buildReport(analysis, reviews, { include_dismissed: false, review_revision: 0 })); expect(md).not.toContain("<script>"); expect(md).not.toContain("![remote]"); expect(md).toContain("\\`\\`\\`"); expect(md).toContain("\\<script\\>"); });
  it("keeps model and user text from adding Markdown structure, and quotes verbatim", async () => {
    const { analysis, reviews } = await reportFixture();
    analysis.findings[0].title = "Title\n\n- injected\n1. num\n---\n    code";
    analysis.findings[0].evidence[0].quote = "Honey & Rye <5_000> ``` (USD)";
    reviews[0].note = "line\n---\n+ plus\n2) two\n    indented\n> quoted";
    const md = toMarkdown(buildReport(analysis, reviews, { include_dismissed: true, review_revision: 0 }));
    expect(md).toContain("### Title - injected 1. num --- code\n");
    expect(md).toContain("````text\nHoney & Rye <5_000> ``` (USD)\n````");
    expect(md).toContain("line\n\\---\n\\+ plus\n2\\) two\nindented\n\\> quoted");
    // The agenda intentionally adds a numbered list; untrusted detail fields cannot.
    expect(md.split("## Decisions still needed")[1]).not.toMatch(/^(- |1\. |---$| {4})/m);
  });
  it("does not export not-comparable as a normal comparison", async () => { const { analysis, reviews } = await reportFixture(); analysis.status = "not_comparable"; expect(() => buildReport(analysis, reviews, { include_dismissed: false, review_revision: 0 })).toThrow(); });
});

it("keeps card, agenda and export order consistent without rearranging canonical evidence", async () => {
  const { sampleAnalysis } = await import("../lib/sample");
  const { orderedFindings } = await import("../lib/findings");
  const analysis = await sampleAnalysis();
  const original = structuredClone(analysis);
  const reviews = analysis.findings.map((f) => ({ finding_id: f.id, disposition: "open" as const, note: `Note for ${f.id}` })).reverse();
  const report = buildReport(analysis, reviews, { include_dismissed: false, review_revision: 0 });
  const ordered = orderedFindings(analysis.findings);
  expect(report.reviews.map((r) => r.finding_id)).toEqual(ordered.map((f) => f.id));
  const markdown = toMarkdown(report);
  expect(markdown).toContain("## Clarification agenda");
  for (const [index, finding] of ordered.entries()) {
    expect(markdown).toContain(`${index + 1}. ${finding.question}`);
    expect(markdown).toContain(`Note for ${finding.id}`);
    for (const evidence of finding.evidence) {
      expect(markdown).toContain(evidence.quote);
      expect(markdown).toContain(evidence.label);
    }
    if (index) expect(markdown.indexOf(`### ${ordered[index - 1].title}`)).toBeLessThan(markdown.indexOf(`### ${finding.title}`));
  }
  expect(analysis).toEqual(original);
});

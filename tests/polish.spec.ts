import { test, expect, type Page, type Locator } from "@playwright/test";
import fs from "node:fs/promises";
import { sampleAnalysis } from "../lib/sample";
import { makeSnapshot, validateCandidate } from "../lib/evidence";
import { attachMetadata } from "../lib/analysis";
import { isError } from "../lib/contracts";

async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 70; i++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Control was not reachable using Tab");
}

test("keyboard sample reaches evidence, note, dismiss/reopen, agenda and exports without a request", async ({ page }, info) => {
  let apiCalls = 0;
  await page.route("**/api/**", (route) => { apiCalls++; return route.abort(); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Clear session", exact: true })).toBeEnabled();
  await tabTo(page, page.getByRole("button", { name: "Explore sample review" }));
  await page.keyboard.press("Enter");
  await expect(page.getByText("Sample data", { exact: true })).toBeVisible();
  const cards = await page.locator(".finding-card strong").allTextContents();
  await tabTo(page, page.getByRole("button", { name: cards[0], exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: cards[0], exact: true })).toBeFocused();
  await tabTo(page, page.getByRole("button", { name: "View Client brief, line 1 in source" }));
  await page.keyboard.press("Enter");
  await expect(page.locator("mark")).toBeFocused();
  await tabTo(page, page.getByRole("button", { name: "Back to finding evidence" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "View Client brief, line 1 in source" })).toBeFocused();
  await tabTo(page, page.getByLabel("Your review note"));
  await page.keyboard.type("Awaiting a booking decision");
  await tabTo(page, page.getByRole("button", { name: "Dismiss finding" }));
  await page.keyboard.press("Enter");
  await tabTo(page, page.getByRole("button", { name: "Reopen finding" }));
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Your review note")).toHaveValue("Awaiting a booking decision");
  await tabTo(page, page.getByRole("button", { name: "Next finding" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: cards[1], exact: true })).toBeFocused();
  await expect(page.getByLabel("Your review note")).toHaveValue("");
  await tabTo(page, page.getByRole("button", { name: "Next finding" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: cards[2], exact: true })).toBeFocused();
  await tabTo(page, page.getByRole("button", { name: "Preview agenda" }));
  await page.keyboard.press("Enter");
  await expect(page.locator(".report-item > h3:not(.report-subhead)")).toHaveText(cards);
  expect(await page.locator(".report-agenda li").count()).toBe(3);
  await tabTo(page, page.locator(".report-agenda a").first());
  await page.keyboard.press("Enter");
  await expect(page.locator(".report-item").first()).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => { window.print = () => { throw new Error("Print unavailable"); }; });
  await tabTo(page, page.getByRole("button", { name: "Print / Save as PDF" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Print failed. Your preview and notes are preserved");
  await tabTo(page, page.getByRole("button", { name: "Download Markdown" }));
  const download = page.waitForEvent("download"); await page.keyboard.press("Enter");
  const file = await download; const path = info.outputPath("sample.md"); await file.saveAs(path);
  const markdown = await fs.readFile(path, "utf8");
  expect(markdown).toContain("## Clarification agenda"); expect(markdown).toContain("Awaiting a booking decision");
  const analysis = await sampleAnalysis();
  for (const finding of analysis.findings) for (const evidence of finding.evidence) {
    expect(markdown).toContain(evidence.quote); expect(markdown).toContain(evidence.label);
  }
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".report-document")).toBeVisible();
  await expect(page.locator(".report-document")).toContainText("Awaiting a booking decision");
  await page.pdf({ path: info.outputPath("sample.pdf"), format: "A4" });
  expect(apiCalls).toBe(0);
});

test("long hostile quotes and notes remain literal and wrap in app and print", async ({ page }, info) => {
  const brief = "<script>window.pwned=true</script>\n" + "An exact long commitment with readable evidence. ".repeat(150);
  const scope = "Delivery plan omits this commitment.";
  const sources = await makeSnapshot({ brief, scope });
  const candidate = validateCandidate({ schema_version: 1, status: "complete", comparison_evidence: [], findings: [{ kind: "clarification", title: "Confirm the long commitment", rationale: "Acceptance needs clarification.", question: "What is the acceptance criterion?", evidence: [{ source_id: "brief", start_line: 1, end_line: 2, quote: brief }] }] }, sources);
  if (isError(candidate)) throw new Error("Invalid fixture");
  const analysis = attachMetadata(candidate, sources, { origin: "sample", duration_ms: 0 });
  await page.route("**/api/analyze", (route) => route.fulfill({ json: { ok: true, analysis } }));
  await page.goto("/");
  await page.getByLabel("Client brief", { exact: true }).fill(brief);
  await page.getByLabel("Proposed delivery plan", { exact: true }).fill(scope);
  await page.getByRole("button", { name: "Compare documents", exact: true }).click();
  await expect(page.locator(".finding-detail blockquote p")).toHaveText(brief);
  const note = '<img src="https://evil.test/note" onerror="window.pwned=true">';
  await page.getByLabel("Your review note").fill(note);
  await page.getByRole("button", { name: "Save Open note" }).click();
  await page.getByRole("button", { name: "Preview report", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".report-item blockquote p")).toHaveText(brief);
  await expect(page.locator(".report-note p")).toHaveText(note);
  await expect(page.locator("main img,main script,main iframe")).toHaveCount(0);
  expect(await page.evaluate(() => "pwned" in window)).toBe(false);
  expect(await page.locator(".report-item").evaluate((el) => getComputedStyle(el).breakInside)).toBe("auto");
  await page.pdf({ path: info.outputPath("long-quotes.pdf"), format: "A4" });
});

import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

for (const source of ["Client brief", "Proposed delivery plan"] as const) {
  test(`R1 rejects oversized ${source} insertion without losing existing text`, async ({ page }) => {
    let calls = 0; let submitted: Record<string, string> | null = null;
    await page.route("**/api/analyze", async (route) => { calls++; submitted = route.request().postDataJSON(); await route.fulfill({ status: 503, json: { ok: false, error: { code: "unavailable", message: "Synthetic browser response" } } }); });
    await page.goto("/"); await expect(page.getByRole("button", { name: "Clear session", exact: true })).toBeEnabled();
    const field = page.getByLabel(source, { exact: true }); const prior = "Existing complete document.";
    await page.getByLabel("Client brief", { exact: true }).fill(prior); await page.getByLabel("Proposed delivery plan", { exact: true }).fill(prior);
    await field.focus(); await page.keyboard.press("Meta+A"); await page.keyboard.insertText("x".repeat(16000) + " REQUIRED_BOOKING_TAIL");
    await expect(field).toHaveValue(prior); await expect(page.locator(".input-limit-error[role=alert]")).toContainText(`${source} insertion was rejected`); await expect(page.locator(".input-limit-error[role=alert]")).toContainText("Previous text is unchanged"); await expect(page.getByRole("button", { name: "Compare documents", exact: true })).toBeDisabled(); expect(calls).toBe(0);
    await fs.mkdir("evidence/review-fixes", { recursive: true }); await page.screenshot({ path: `evidence/review-fixes/oversize-${source === "Client brief" ? "brief" : "scope"}.png`, fullPage: true });
    const tail = " REQUIRED_BOOKING_TAIL"; const boundary = "x".repeat(16000 - tail.length) + tail;
    await field.focus(); await page.keyboard.press("Meta+A"); await page.keyboard.insertText(boundary); await expect(field).toHaveValue(boundary); await expect(page.locator(".input-limit-error")).toHaveCount(0); await expect(page.getByRole("button", { name: "Compare documents", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Compare documents", exact: true }).click(); await expect(page.locator(".error-box[role=alert]")).toBeVisible(); expect(calls).toBe(1); expect(submitted).not.toBeNull(); expect(submitted![source === "Client brief" ? "brief" : "scope"]).toBe(boundary);
  });
}

test("R2 native print suppresses stale and unsaved report content until refresh", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Explore sample review" }).click();
  await page.getByLabel("Your review note").fill("ORIGINAL_OPEN_NOTE"); await page.getByRole("button", { name: "Save Open note" }).click(); await page.getByRole("button", { name: "Preview report", exact: true }).click();
  await page.getByRole("button", { name: "02 Review" }).click(); await page.getByLabel("Your review note").fill("NEW_DECISION_AFTER_PREVIEW"); await page.getByRole("button", { name: "03 Report" }).click();
  await page.emulateMedia({ media: "print" }); await expect(page.locator(".report-document")).not.toBeVisible(); await expect(page.locator(".print-blocker")).toContainText("Save your notes and refresh the preview before printing"); await expect(page.locator("body")).not.toContainText("ORIGINAL_OPEN_NOTE", { useInnerText: true });
  await fs.mkdir("evidence/review-fixes", { recursive: true }); await page.pdf({ path: "evidence/review-fixes/unsaved-print-blocked.pdf", format: "A4", printBackground: true });
  await page.emulateMedia({ media: "screen" }); await page.getByRole("button", { name: "02 Review" }).click(); await page.getByRole("button", { name: "Record decision", exact: true }).click(); await page.getByRole("button", { name: "03 Report" }).click(); await expect(page.getByText("Preview is outdated", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Download Markdown" })).toBeDisabled();
  await page.emulateMedia({ media: "print" }); await expect(page.locator(".report-document")).not.toBeVisible(); await expect(page.locator(".print-blocker")).toContainText("Refresh the preview before printing"); await expect(page.locator("body")).not.toContainText("ORIGINAL_OPEN_NOTE", { useInnerText: true }); await page.pdf({ path: "evidence/review-fixes/stale-print-blocked.pdf", format: "A4", printBackground: true }); await page.screenshot({ path: "evidence/review-fixes/stale-print-blocked.png", fullPage: true });
  await page.emulateMedia({ media: "screen" }); await page.getByRole("button", { name: "Refresh preview" }).click(); await page.emulateMedia({ media: "print" }); await expect(page.locator(".print-blocker")).not.toBeVisible(); await expect(page.locator(".report-document")).toBeVisible(); await expect(page.locator(".report-document")).toContainText("NEW_DECISION_AFTER_PREVIEW"); await expect(page.locator(".report-document")).not.toContainText("ORIGINAL_OPEN_NOTE"); await expect(page.locator(".report-stats")).toContainText(/Open\s*2/); await expect(page.locator(".report-stats")).toContainText(/Decision recorded\s*1/); await page.pdf({ path: "evidence/review-fixes/refreshed-report.pdf", format: "A4", printBackground: true });
});

test("R3 Compare tab uses a cancellable edit transaction and restores review", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Explore sample review" }).click(); await page.getByRole("button", { name: "The launch dates disagree", exact: true }).click();
  await page.getByLabel("Your review note").fill("PRESERVE_THIS_REVIEW"); await page.getByRole("button", { name: "Record decision", exact: true }).click();
  await page.getByRole("button", { name: "01 Compare" }).click(); await expect(page.getByRole("button", { name: "Cancel editing" })).toBeVisible(); await expect(page.getByText("Editing sources — previous findings are inactive.", { exact: true })).toBeVisible(); const original = await page.getByLabel("Client brief", { exact: true }).inputValue();
  await page.getByLabel("Client brief", { exact: true }).fill("Changed brief"); await page.getByRole("button", { name: "01 Compare" }).click(); await expect(page.getByRole("button", { name: "Cancel editing" })).toBeVisible(); await fs.mkdir("evidence/review-fixes", { recursive: true }); await page.screenshot({ path: "evidence/review-fixes/compare-edit-transaction.png", fullPage: true });
  await page.getByRole("button", { name: "Cancel editing" }).click(); await expect(page.getByRole("heading", { name: "The launch dates disagree", exact: true })).toBeVisible(); await expect(page.getByLabel("Your review note")).toHaveValue("PRESERVE_THIS_REVIEW"); await expect(page.getByText("State:", { exact: false }).filter({ hasText: "Decision recorded" })).toBeVisible();
  await page.getByRole("button", { name: "Preview report", exact: true }).click(); await expect(page.locator(".report-document")).toContainText("PRESERVE_THIS_REVIEW"); await expect(page.locator(".report-stats")).toContainText(/Decision recorded\s*1/);
  await page.getByRole("button", { name: "01 Compare" }).click(); await expect(page.getByLabel("Client brief", { exact: true })).toHaveValue(original); await page.getByRole("button", { name: "Cancel editing" }).click(); await expect(page.getByLabel("Your review note")).toHaveValue("PRESERVE_THIS_REVIEW");
});

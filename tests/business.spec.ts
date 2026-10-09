import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

test("Business demo connects exact campaign/deadline evidence to a potential consequence, decision and report", async ({ page }) => {
  let calls = 0; page.on("request", (request) => { if (request.url().endsWith("/api/analyze")) calls++; });
  await page.goto("/"); await expect(page.getByLabel("Proposed delivery plan", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Explore sample review" }).click();
  await expect(page.getByRole("heading", { name: "Booking form is not in the scope", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "The launch dates disagree", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The launch dates disagree", exact: true })).toBeVisible();
  await expect(page.locator(".finding-detail")).toContainText("Potential business consequence");
  await expect(page.locator(".rationale")).toContainText("may miss the stated 20 October campaign");
  await expect(page.locator(".question-box")).toContainText("move the campaign to 27 October");
  await page.getByRole("button", { name: "View Client brief, line 4 in source" }).click();
  await expect(page.locator("mark")).toHaveText("Launch supports the bakery's 20 October campaign; booking must be available on launch day.");
  const note = "Synthetic outcome: client reportedly accepts 27 October and moves the campaign; revised delivery plan must include booking.";
  await page.getByLabel("Your review note").fill(note); await page.getByRole("button", { name: "Record decision", exact: true }).click();
  await page.getByRole("button", { name: "Preview report", exact: true }).click();
  await expect(page.locator(".report-document")).toContainText(note);
  await expect(page.locator(".report-document")).toContainText("Potential business consequence");
  await expect(page.locator(".report-stats")).toContainText(/Decision recorded\s*1/);
  await expect(page.locator(".report-stats")).toContainText(/Open\s*2/);
  await expect(page.locator(".report-document")).toContainText("client assent is unverified");
  const downloadEvent = page.waitForEvent("download"); await page.getByRole("button", { name: "Download Markdown" }).click();
  const download = await downloadEvent; await fs.mkdir("evidence/business", { recursive: true }); await download.saveAs("evidence/business/decision-report.md");
  const markdown = await fs.readFile("evidence/business/decision-report.md", "utf8");
  expect(markdown).toContain("Potential business consequence (interpretation)"); expect(markdown).toContain("20 October campaign"); expect(markdown).toContain(note); expect(markdown).toContain("Sample data — illustrative findings written by hand."); expect(calls).toBe(0);
  await page.screenshot({ path: "evidence/business/decision-report-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: "evidence/business/decision-report-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.getByRole("button", { name: "02 Review" }).click(); await page.screenshot({ path: "evidence/business/deadline-review.png", fullPage: true });
});

test("a rejected insertion blocks Retry as well as Compare and never sends preserved texts unexpectedly", async ({ page }) => {
  let calls = 0; await page.route("**/api/analyze", async (route) => { calls++; await route.fulfill({ status: 503, json: { ok: false, error: { code: "unavailable", message: "Synthetic browser response" } } }); });
  await page.goto("/"); const brief = page.getByLabel("Client brief", { exact: true }); const plan = page.getByLabel("Proposed delivery plan", { exact: true });
  await brief.fill("Launch on 20 October."); await plan.fill("Launch on 27 October."); await page.getByRole("button", { name: "Compare documents", exact: true }).click(); await expect(page.getByRole("button", { name: "Retry comparison" })).toBeEnabled(); expect(calls).toBe(1);
  await brief.focus(); await page.keyboard.press("Meta+A"); await page.keyboard.insertText("x".repeat(16000) + " REQUIRED_TAIL");
  await expect(page.locator(".input-limit-error[role=alert]")).toBeVisible(); await expect(brief).toHaveValue("Launch on 20 October."); await expect(page.getByRole("button", { name: "Retry comparison" })).toBeDisabled(); await expect(page.getByRole("button", { name: "Compare documents", exact: true })).toBeDisabled(); expect(calls).toBe(1);
  await page.getByLabel("Project title").fill("Local title edit"); await expect(page.getByRole("button", { name: "Compare documents", exact: true })).toBeDisabled();
  await brief.fill("Launch on 21 October."); await expect(page.locator(".input-limit-error")).toHaveCount(0); await expect(page.getByRole("button", { name: "Compare documents", exact: true })).toBeEnabled(); await page.getByRole("button", { name: "Compare documents", exact: true }).click(); await expect(page.locator(".error-box[role=alert]")).toBeVisible(); expect(calls).toBe(2);
});

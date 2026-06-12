#!/usr/bin/env node
/**
 * Scratch headless Playwright repro template.
 *
 * Copy to scratch/<issue>-ui-repro.mjs, replace the action/assert block, and
 * run while the relevant runtime is warm. It uses a headless isolated browser
 * so it should not pop up on chai's desktop. The default runtime is Chrome web
 * shell proof; set REPRO_RUNTIME when attaching to a Tauri app or Remote Runtime
 * path, and do not use Chrome-only proof for Rust/Tauri-backed behavior.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE_URL = process.env.MARINARA_URL ?? "http://localhost:1420";
const RUNTIME = process.env.REPRO_RUNTIME ?? "Chrome web shell";
const ROUTE_PATH = process.env.REPRO_ROUTE ?? "/";
const OUT_DIR = process.env.REPRO_OUT_DIR ?? "scratch/playwright-proof";
const PHASE = process.env.REPRO_PHASE ?? "after";
const RECIPE = process.env.REPRO_RECIPE ?? "ui-repro";
const SCREENSHOT_NAME = process.env.REPRO_SCREENSHOT ?? `${PHASE}-ui.png`;
const ASSERT_SELECTOR = process.env.REPRO_ASSERT_SELECTOR ?? '[data-component="TopBar"]';
const VIEWPORT = {
  width: Number(process.env.REPRO_VIEWPORT_WIDTH ?? 1440),
  height: Number(process.env.REPRO_VIEWPORT_HEIGHT ?? 900),
};

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: VIEWPORT });
const page = await context.newPage();
const consoleMessages = [];

page.on("console", (message) => {
  if (["error", "warning"].includes(message.type())) {
    consoleMessages.push({ type: message.type(), text: message.text() });
  }
});

try {
  const url = new URL(ROUTE_PATH, BASE_URL).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  // Replace with the smallest user path that reproduces the bug.
  await page.waitForSelector(ASSERT_SELECTOR, { timeout: 15000 });

  // Replace with concrete assertions for the fixed behavior.
  const assertionVisible = await page.locator(ASSERT_SELECTOR).isVisible();
  if (!assertionVisible) throw new Error(`${ASSERT_SELECTOR} did not become visible`);

  const screenshot = `${OUT_DIR}/${SCREENSHOT_NAME}`;
  await page.screenshot({ path: screenshot, fullPage: true });

  console.log(
    JSON.stringify(
      {
        phase: PHASE,
        recipe: RECIPE,
        runtime: RUNTIME,
        passed: true,
        url,
        viewport: VIEWPORT,
        evidence: {
          screenshot,
          consoleMessages,
        },
        traceEvent: {
          phase: "verify",
          action: RECIPE,
          outcome: "passed",
          evidence: screenshot,
        },
        ledgerHint:
          "Append evidence.browserRecipes and evidence.visualProof; upload/attach screenshots and record their URLs before citing them in a PR.",
        consoleMessages,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const screenshot = `${OUT_DIR}/${PHASE}-failed.png`;
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
  console.log(
    JSON.stringify(
      {
        phase: PHASE,
        recipe: RECIPE,
        runtime: RUNTIME,
        passed: false,
        url: page.url(),
        viewport: VIEWPORT,
        evidence: {
          screenshot,
          consoleMessages,
        },
        traceEvent: {
          phase: "verify",
          action: RECIPE,
          outcome: "failed",
          evidence: screenshot,
        },
        ledgerHint:
          "Record this as reproduction/verification evidence and keep the screenshot under scratch until it is uploaded/attached and the URL is recorded.",
        error: error instanceof Error ? error.message : String(error),
        consoleMessages,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}

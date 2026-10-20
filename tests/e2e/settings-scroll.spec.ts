import { expect, test, type Page } from "@playwright/test";

// Settings used to ignore wheel and touch scrolling: its body grew to its content height inside a block layout, so
// it never scrolled, and its overscroll containment stopped the scroll from reaching the panel around it.

async function openSettingsAppearance(page: Page) {
  await page.goto("/");
  const directSettings = page.getByRole("button", { name: "Settings", exact: true });
  const tools = page.getByRole("button", { name: "Tools", exact: true }).last();
  await expect(directSettings.or(tools).first()).toBeVisible();
  if (await directSettings.isVisible()) {
    await directSettings.click();
  } else {
    await tools.click();
    await page.getByRole("dialog", { name: "Tools panels" }).getByRole("button", { name: "Settings" }).click();
  }
  await page.getByRole("tab", { name: "Appearance" }).click();
  const body = page.getByRole("tabpanel");
  await expect(body).toBeVisible();
  return body;
}

test("settings scrolls with the mouse wheel", async ({ page }) => {
  const body = await openSettingsAppearance(page);
  const box = (await body.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(300, box.height / 2));
  await page.mouse.wheel(0, 500);
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

  test("settings scrolls with a finger swipe", async ({ page, context }) => {
    const body = await openSettingsAppearance(page);
    const box = (await body.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.7;
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let step = 1; step <= 12; step++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - step * 30 }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  });
});

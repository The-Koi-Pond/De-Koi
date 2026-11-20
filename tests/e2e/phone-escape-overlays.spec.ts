import { expect, test, type Page } from "@playwright/test";

// On a phone the open side panel (Tools sheet, gallery, tracker, …) used to close on every Escape: a capture-phase
// listener in the app shell ran before the overlay Escape stack, so Escape in a lightbox or confirm dialog opened inside
// the panel closed the whole panel too. Overlays opened later must win, as on desktop.

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const image = {
  id: "gallery-image-e2e",
  folderId: null,
  filePath: "",
  filename: null,
  prompt: "A koi in a pond",
  provider: "test",
  model: "test",
  width: 1,
  height: 1,
  createdAt: "2026-11-20T12:00:00.000Z",
  url: PIXEL,
  customKind: null,
  customName: null,
};

const writes: string[] = [];

async function routeRuntime(page: Page) {
  await page.route(/\/health/, (route) =>
    route.fulfill({ json: { ok: true, runtime: "de-koi-server", writable: true } }),
  );
  await page.route(/\/api\/invoke$/, async (route) => {
    const body = route.request().postDataJSON() as { command?: string; args?: { entity?: string } };
    const command = String(body.command ?? "");
    if (command === "storage_list") {
      await route.fulfill({ json: body.args?.entity === "global-gallery" ? [image] : [] });
      return;
    }
    if (command === "storage_get") {
      await route.fulfill({ json: null });
      return;
    }
    // Gallery writes only: the app's own background jobs also write (memory maintenance).
    if (/^storage_(create|update|delete)/.test(command) && /gallery/.test(String(body.args?.entity))) {
      writes.push(`${command} ${body.args?.entity ?? ""}`);
    }
    await route.fulfill({ status: 501, json: { message: `Unhandled browser-harness command: ${command}` } });
  });
}

test.use({ viewport: { width: 660, height: 900 }, isMobile: true, hasTouch: true });

test.beforeEach(async ({ page, baseURL }) => {
  writes.length = 0;
  await routeRuntime(page);
  await page.addInitScript(
    ({ url }) => {
      localStorage.setItem(
        "marinara-engine-ui-tauri",
        JSON.stringify({ state: { remoteRuntimeUrl: url, hasCompletedOnboarding: true }, version: 11 }),
      );
    },
    { url: new URL(baseURL ?? "").origin },
  );
  await page.goto("/");
});

function toolsButton(page: Page) {
  return page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Tools", exact: true });
}

async function openGallery(page: Page) {
  await toolsButton(page).click();
  await page.getByRole("dialog", { name: "Tools panels" }).getByRole("button", { name: "Gallery" }).click();
  const panel = page.getByRole("dialog", { name: "Settings and tools panel" });
  await expect(panel.getByTitle("Drag onto a folder to move it")).toBeVisible();
  return panel;
}

test("Escape in the gallery lightbox closes only the lightbox", async ({ page }) => {
  const panel = await openGallery(page);
  await panel.getByTitle("Drag onto a folder to move it").getByRole("button").first().click();
  const moveSelect = page.getByLabel("Move image to folder");
  await expect(moveSelect).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(moveSelect).toBeHidden();
  await expect(panel).toBeVisible();

  // With nothing on top any more, the next Escape closes the panel as before.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("Escape in a confirm dialog opened inside the panel closes only the dialog", async ({ page }) => {
  const panel = await openGallery(page);
  await panel.getByTitle("Drag onto a folder to move it").getByTitle("Delete").click();
  const cancel = page.getByRole("button", { name: "Cancel" });
  await expect(cancel).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(cancel).toBeHidden();
  await expect(panel).toBeVisible();
  expect(writes).toEqual([]);
});

test("Escape with nothing on top still closes the Tools sheet and hands focus back", async ({ page }) => {
  await toolsButton(page).focus();
  await toolsButton(page).press("Enter");
  const sheet = page.getByRole("dialog", { name: "Tools panels" });
  await expect(sheet).toBeVisible();
  await expect.poll(() => sheet.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await page.keyboard.press("Escape");

  await expect(sheet).toBeHidden();
  await expect(toolsButton(page)).toBeFocused();
});

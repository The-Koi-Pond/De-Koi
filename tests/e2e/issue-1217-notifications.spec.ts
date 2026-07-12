import { expect, test } from "@playwright/test";

test("settings shows conversation native notification opt-in", async ({ page }) => {
  await page.goto("/");
  const directSettings = page.getByRole("button", { name: "Settings", exact: true });
  const tools = page.getByRole("button", { name: "Tools", exact: true });
  const moreNavigation = page.getByRole("button", {
    name: "More navigation",
    exact: true,
  });
  await expect(directSettings.or(tools).or(moreNavigation)).toBeVisible();
  if (await directSettings.isVisible()) {
    await directSettings.click();
  } else {
    const navigationTrigger = (await tools.isVisible())
      ? tools
      : moreNavigation;
    await navigationTrigger.click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  }
  await page.getByRole("tab", { name: "Appearance" }).evaluate((button) => {
    (button as HTMLButtonElement).click();
  });

  await expect(page.getByText("Notifications", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Native notifications")).toBeVisible();
});

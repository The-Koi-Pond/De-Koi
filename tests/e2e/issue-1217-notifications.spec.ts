import { expect, test } from "@playwright/test";

test("settings shows conversation native notification opt-in", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Appearance" }).evaluate((button) => {
    (button as HTMLButtonElement).click();
  });

  await expect(page.getByText("Notifications", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Native notifications")).toBeVisible();
});

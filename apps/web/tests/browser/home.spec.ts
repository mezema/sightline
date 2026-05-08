import { expect, test } from "@playwright/test";

test("renders the durable inspection scaffold", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Inspections" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Inspection library" })).toBeVisible();
  await expect(page.getByLabel("Result filters").getByRole("button", { name: /All \d+/ })).toBeVisible();
  await expect(page.getByLabel("Result filters").getByRole("button", { name: /Defect \d/ })).toBeVisible();
  await expect(page.getByLabel("Result filters").getByRole("button", { name: /Failed \d/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry target" })).toBeVisible();
});

test("creates, reopens, marks wrong, and retries with fake analyzer data", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Start inspection" }).click();
  await expect(page.getByText(/5 of 5 inspected · 2 with defect · 1 failed/)).toBeVisible({ timeout: 8000 });

  await page.reload();
  await expect(page.getByRole("region", { name: "Inspection library" })).toContainText("5/5 inspected");

  await page.getByRole("button", { name: "Mark wrong" }).click();
  await expect(page.getByLabel("Result filters").getByRole("button", { name: "Defect 1" })).toBeVisible();
  await expect(page.getByLabel("Result filters").getByRole("button", { name: "Clean 3" })).toBeVisible();

  await page.getByRole("button", { name: /target-crack-04\.jpg/ }).click();
  await page.getByRole("button", { name: "Retry target" }).click();
  await expect(page.getByText(/5 of 5 inspected · 2 with defect · 0 failed/)).toBeVisible({ timeout: 8000 });
  await expect(page.getByLabel("Result filters").getByRole("button", { name: "Failed 0" })).toBeVisible();
});

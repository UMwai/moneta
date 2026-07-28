import { expect, test } from "@playwright/test";

import {
  login,
  supplyMissingInsightsPeriod,
} from "./helpers";

test("creates a funded budget and dismisses a generated insight", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "Budgets", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Budgets" })).toBeVisible();

  await page.getByLabel("Category").selectOption({ label: "Restaurants" });
  await page.getByLabel("Monthly amount").fill("1000");
  await page.getByRole("button", { name: "Save budget" }).click();
  await expect(page.getByRole("status")).toContainText(
    /Restaurants saved for/,
  );

  const restaurantBudget = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Restaurants" }) });
  await expect(restaurantBudget).toBeVisible();
  const progress = restaurantBudget.getByRole("progressbar");
  await expect(progress).toBeVisible();
  await expect
    .poll(async () => Number(await progress.getAttribute("aria-valuenow")))
    .toBeGreaterThan(0);

  await supplyMissingInsightsPeriod(page);
  await page.getByRole("link", { name: "Insights", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();

  const insightCards = page.getByRole("article");
  await expect.poll(() => insightCards.count()).toBeGreaterThan(0);
  const firstInsight = insightCards.first();
  const title = await firstInsight.getByRole("heading", { level: 3 }).innerText();
  await firstInsight
    .getByRole("button", { name: `Dismiss ${title}` })
    .click();

  await expect(page.getByRole("status")).toContainText("Insight dismissed.");
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toHaveCount(0);
});

import { expect, test } from "@playwright/test";

import {
  login,
  seedImportAccount,
  shiftedSampleCsv,
} from "./helpers";

test("imports a CSV and exercises ledger search and account surfaces", async ({
  page,
}) => {
  await login(page);
  await seedImportAccount(page);

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Import transactions from CSV" }),
  ).toBeVisible();

  await page.getByLabel("CSV file").setInputFiles({
    name: "sample.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(shiftedSampleCsv()),
  });
  await page
    .getByLabel("Destination account")
    .selectOption({ label: "E2E Checking" });
  await page.getByRole("button", { name: "Import CSV" }).click();
  await expect(page.getByRole("status")).toContainText(
    "30 transactions imported.",
  );

  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Transactions" }),
  ).toBeVisible();
  await expect(page.getByText("31 transactions")).toBeVisible();

  const diningRow = page
    .getByRole("row")
    .filter({ hasText: "July Signature Dining" });
  await expect(diningRow).toBeVisible();
  await expect(
    diningRow.getByRole("combobox", {
      name: "Category for July Signature Dining",
    }),
  ).toHaveValue("cat_restaurants");

  await page.getByLabel("Search").fill("Signature Dining");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("1 transaction")).toBeVisible();
  await expect(diningRow).toBeVisible();
  await expect(page.getByText("June Payroll")).toHaveCount(0);

  await page.getByRole("link", { name: "Accounts", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "E2E Checking" }),
  ).toBeVisible();
});

import { expect, test } from "@playwright/test";

import { PASSWORD, USERNAME } from "./helpers";

test("first-run setup, logout, protected redirect, and login validation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL("/setup");
  await expect(
    page.getByRole("heading", { name: "Make it yours." }),
  ).toBeVisible();

  await page.getByLabel("Username").fill(USERNAME);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create local account" }).click();

  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: "Good to see the whole picture." }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const firstLogout = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/logout") && response.status() === 200,
  );
  await page.getByRole("button", { name: "Sign out" }).click();
  await firstLogout;

  await page.goto("/transactions");
  await expect(page).toHaveURL("/login");

  await page.getByLabel("Username").fill(USERNAME);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: "Good to see the whole picture." }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const secondLogout = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/logout") && response.status() === 200,
  );
  await page.getByRole("button", { name: "Sign out" }).click();
  await secondLogout;
  await page.goto("/login");

  await page.getByLabel("Username").fill(USERNAME);
  await page.getByLabel("Password").fill("definitely-the-wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("status")).toContainText(
    /Invalid username or password|Your session has expired/,
  );
  await page.goto("/budgets");
  await expect(page).toHaveURL("/login");
});

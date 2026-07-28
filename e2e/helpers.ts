import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const USERNAME = "e2e-owner";
export const PASSWORD = "correct-horse-moneta";

function period(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function currentPeriod(): string {
  return period(new Date());
}

export function shiftedSampleCsv(): string {
  const fixture = readFileSync(
    resolve(process.cwd(), "e2e", "fixtures", "sample.csv"),
    "utf8",
  );
  const lines = fixture.trimEnd().split(/\r?\n/);
  const sourcePeriods = [
    ...new Set(lines.slice(1).map((line) => line.slice(0, 7))),
  ].sort();

  if (sourcePeriods.length !== 2) {
    throw new Error("sample.csv must span exactly two statement months");
  }

  const now = new Date();
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const replacements = new Map([
    [sourcePeriods[0], period(previous)],
    [sourcePeriods[1], period(now)],
  ]);

  return lines
    .map((line, index) => {
      if (index === 0) return line;
      return `${replacements.get(line.slice(0, 7))}${line.slice(7)}`;
    })
    .join("\n");
}

export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username").fill(USERNAME);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: "Good to see the whole picture." }),
  ).toBeVisible();
}

export async function seedImportAccount(page: Page): Promise<void> {
  const response = await page.request.post(
    new URL("/api/import/csv", page.url()).toString(),
    {
      multipart: {
        file: {
          name: "account-seed.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(
            [
              "Date,Description,Amount,Category,Account,Transaction ID",
              `${currentPeriod()}-01,Opening balance,0.01,Other Income,E2E Checking,e2e-account-seed`,
            ].join("\n"),
          ),
        },
      },
    },
  );

  expect(response.ok(), await response.text()).toBe(true);
}

export async function supplyMissingInsightsPeriod(page: Page): Promise<void> {
  await page.route("**/api/insights", async (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has("period")) {
      url.searchParams.set("period", currentPeriod());
    }
    await route.continue({ url: url.toString() });
  });
}

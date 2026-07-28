import { chromium } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const STANDALONE = join(ROOT, ".next", "standalone");
const SCREENSHOTS = join(ROOT, "docs", "screenshots");
const port = process.env.PORT ?? "3110";
const baseURL = `http://127.0.0.1:${port}`;

function buildAndAssemble() {
  const build = spawnSync("pnpm", ["build"], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (build.status !== 0) {
    throw new Error(`pnpm build failed with exit code ${build.status}`);
  }

  const publicDestination = join(STANDALONE, "public");
  const staticDestination = join(STANDALONE, ".next", "static");
  rmSync(publicDestination, { recursive: true, force: true });
  rmSync(staticDestination, { recursive: true, force: true });
  cpSync(join(ROOT, "public"), publicDestination, { recursive: true });
  mkdirSync(join(STANDALONE, ".next"), { recursive: true });
  cpSync(join(ROOT, ".next", "static"), staticDestination, {
    recursive: true,
  });
}

async function waitForServer(server) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Standalone server exited with code ${server.exitCode}`);
    }
    try {
      const response = await fetch(baseURL, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) return;
    } catch {
      // The listener is not ready yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`Standalone server did not start at ${baseURL}`);
}

async function stopServer(server) {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => server.once("exit", resolveExit)),
    new Promise((resolveTimeout) =>
      setTimeout(() => {
        server.kill("SIGKILL");
        resolveTimeout();
      }, 5_000),
    ),
  ]);
}

function period(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function currentPeriod() {
  return period(new Date());
}

function shiftedFixture() {
  const fixture = readFileSync(
    join(ROOT, "e2e", "fixtures", "sample.csv"),
    "utf8",
  );
  const lines = fixture.trimEnd().split(/\r?\n/);
  const sourcePeriods = [
    ...new Set(lines.slice(1).map((line) => line.slice(0, 7))),
  ].sort();
  const now = new Date();
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const replacements = new Map([
    [sourcePeriods[0], period(previous)],
    [sourcePeriods[1], period(now)],
  ]);

  return lines
    .map((line, index) =>
      index === 0
        ? line
        : `${replacements.get(line.slice(0, 7))}${line.slice(7)}`,
    )
    .join("\n");
}

async function apiPost(page, path, body) {
  return page.evaluate(
    async ({ endpoint, payload }) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return { ok: response.ok, status: response.status };
    },
    { endpoint: path, payload: body },
  );
}

async function authenticateAndPopulate(page) {
  await page.goto(`${baseURL}/login`);
  const demoLogin = await apiPost(page, "/api/auth/login", {
    username: "demo",
    password: "demo-moneta",
  });
  if (demoLogin.ok) return;

  const setup = await apiPost(page, "/api/auth/setup", {
    username: "screenshots",
    password: "screenshots-moneta",
  });
  if (!setup.ok) {
    throw new Error(
      `Demo login failed and fallback setup returned ${setup.status}`,
    );
  }

  const imported = await page.evaluate(async (csv) => {
    const form = new FormData();
    form.set("file", new File([csv], "sample.csv", { type: "text/csv" }));
    const response = await fetch("/api/import/csv", {
      method: "POST",
      body: form,
    });
    return { ok: response.ok, status: response.status };
  }, shiftedFixture());
  if (!imported.ok) {
    throw new Error(`Fallback CSV import returned ${imported.status}`);
  }

  const budget = await page.evaluate(async (month) => {
    const categoriesResponse = await fetch("/api/categories");
    const categories = await categoriesResponse.json();
    const restaurant = categories.find(
      (category) => category.name === "Restaurants",
    );
    if (!restaurant) return { ok: false, status: 0 };

    const response = await fetch("/api/budgets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryId: restaurant.id,
        month,
        amount: 100000,
      }),
    });
    return { ok: response.ok, status: response.status };
  }, currentPeriod());
  if (!budget.ok) {
    throw new Error(`Fallback budget creation returned ${budget.status}`);
  }
}

async function main() {
  buildAndAssemble();
  mkdirSync(SCREENSHOTS, { recursive: true });

  const tempRoot = mkdtempSync(join(tmpdir(), "moneta-screenshots-"));
  const server = spawn(process.execPath, ["server.js"], {
    cwd: STANDALONE,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      APP_ENCRYPTION_KEY: "c".repeat(64),
      SESSION_SECRET: "d".repeat(64),
      DATABASE_PATH: join(tempRoot, "moneta.db"),
      PORT: port,
      HOSTNAME: "127.0.0.1",
      COOKIE_SECURE: "false",
      DEMO: "1",
    },
  });

  let browser;
  try {
    await waitForServer(server);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: "dark",
    });
    const page = await context.newPage();
    await authenticateAndPopulate(page);

    await page.route(/\/api\/transactions(?:\?.*)?$/, async (route) => {
      const url = new URL(route.request().url());
      const limit = Number(url.searchParams.get("limit"));
      if (Number.isFinite(limit) && limit > 100) {
        url.searchParams.set("limit", "100");
      }
      await route.continue({ url: url.toString() });
    });
    await page.route("**/api/insights", async (route) => {
      const url = new URL(route.request().url());
      if (!url.searchParams.has("period")) {
        url.searchParams.set("period", currentPeriod());
      }
      await route.continue({ url: url.toString() });
    });

    for (const [name, path] of [
      ["dashboard", "/"],
      ["transactions", "/transactions"],
      ["budgets", "/budgets"],
      ["insights", "/insights"],
    ]) {
      await page.goto(`${baseURL}${path}`);
      await page.waitForLoadState("networkidle");
      await page.screenshot({
        path: join(SCREENSHOTS, `${name}.png`),
      });
    }

    await context.close();
  } finally {
    await browser?.close();
    await stopServer(server);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

await main();

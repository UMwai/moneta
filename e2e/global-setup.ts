import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const STANDALONE = join(ROOT, ".next", "standalone");
const port = process.env.PORT ?? "3100";
const baseURL = `http://127.0.0.1:${port}`;

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
      } else {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed (${signal ?? `exit ${code}`})`,
          ),
        );
      }
    });
  });
}

function assembleStandalone(): void {
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

async function waitForServer(server: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Standalone server exited with code ${server.exitCode}`);
    }

    try {
      const response = await fetch(baseURL, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) return;
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }

  throw new Error(`Standalone server did not start at ${baseURL}`, {
    cause: lastError,
  });
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;

  server.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolveExit) => server.once("exit", () => resolveExit())),
    new Promise<void>((resolveTimeout) =>
      setTimeout(() => {
        server.kill("SIGKILL");
        resolveTimeout();
      }, 5_000),
    ),
  ]);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  await run("pnpm", ["build"]);
  assembleStandalone();

  const tempRoot = mkdtempSync(join(tmpdir(), "moneta-e2e-"));
  const server = spawn(process.execPath, ["server.js"], {
    cwd: STANDALONE,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      APP_ENCRYPTION_KEY: "a".repeat(64),
      SESSION_SECRET: "b".repeat(64),
      DATABASE_PATH: join(tempRoot, "moneta.db"),
      PORT: port,
      HOSTNAME: "127.0.0.1",
      COOKIE_SECURE: "false",
    },
  });

  try {
    await waitForServer(server);
  } catch (error) {
    await stopServer(server);
    rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }

  return async () => {
    await stopServer(server);
    rmSync(tempRoot, { recursive: true, force: true });
  };
}

import { beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, createTestDb } from "@/db";
import {
  bumpSessionVersion,
  createUser,
  findUserByUsername,
  getSessionVersion,
  updatePassword,
} from "@/lib/domain/repos/users";
import type { ApiError, SessionUser } from "@/lib/types";

const { session } = vi.hoisted(() => ({
  session: { value: null as (SessionUser & { sessionVersion: number }) | null },
}));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    clearSession: vi.fn(async () => {}),
    getSession: vi.fn(async () => session.value),
    requireSession: vi.fn(async () => {
      if (!session.value) throw new actual.SessionRequiredError();
      return session.value;
    }),
  };
});

vi.mock("@/lib/server/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/store")>();
  return {
    ...actual,
    store: new actual.InMemoryStore({
      users: [
        {
          id: "usr_ada",
          username: "ada",
          passwordHash: "irrelevant",
          sessionVersion: 1,
        },
      ],
    }),
  };
});

const { store } = await import("@/lib/server/store");
const { apiHandler, requireLiveSession } = await import("@/lib/server/api");
const { POST: logout } = await import("@/app/api/auth/logout/route");

beforeEach(async () => {
  // The store is shared across the file, so each test starts from whatever
  // version the previous one left behind rather than assuming 1.
  session.value = {
    id: "usr_ada",
    username: "ada",
    sessionVersion: (await store.sessionVersion("usr_ada")) ?? 1,
  };
});

describe("session revocation", () => {
  it("accepts a token whose version still matches the user row", async () => {
    await expect(requireLiveSession()).resolves.toMatchObject({ id: "usr_ada" });
  });

  it("rejects a signed token once the version has moved on", async () => {
    await store.revokeSessions("usr_ada");

    // The cookie is untouched and its signature is still valid — only the
    // version comparison stands between it and the data plane.
    await expect(requireLiveSession()).rejects.toThrow(/Authentication required/);

    const response = await apiHandler(async () => ({ secret: true }));
    expect(response.status).toBe(401);
    expect(((await response.json()) as ApiError).error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a token for a user that no longer exists", async () => {
    session.value = { id: "usr_gone", username: "ghost", sessionVersion: 1 };

    await expect(requireLiveSession()).rejects.toThrow(/Authentication required/);
  });

  it("bumps the version on logout so an exfiltrated cookie dies with it", async () => {
    const before = await store.sessionVersion("usr_ada");

    const response = await logout();

    expect(response.status).toBe(200);
    expect(await store.sessionVersion("usr_ada")).toBe((before ?? 0) + 1);
    await expect(requireLiveSession()).rejects.toThrow(/Authentication required/);
  });

  it("logs out cleanly when there is no session to revoke", async () => {
    session.value = null;

    expect((await logout()).status).toBe(200);
  });
});

describe("users repo session versions", () => {
  it("starts at 1 and is bumped by a password change", () => {
    const db = createTestDb();
    try {
      const user = createUser(db, { username: "ada", passwordHash: "hash" });
      expect(user.sessionVersion).toBe(1);
      expect(getSessionVersion(db, user.id)).toBe(1);

      bumpSessionVersion(db, user.id);
      expect(getSessionVersion(db, user.id)).toBe(2);

      // A password change has to invalidate the sessions opened with the old
      // one, which is the whole reason the user is changing it.
      updatePassword(db, user.id, "new-hash");
      expect(getSessionVersion(db, user.id)).toBe(3);
      expect(findUserByUsername(db, "ada")).toMatchObject({
        passwordHash: "new-hash",
        sessionVersion: 3,
      });

      expect(getSessionVersion(db, "usr_missing")).toBeNull();
    } finally {
      closeDb(db);
    }
  });
});

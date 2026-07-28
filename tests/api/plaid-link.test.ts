import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Connection } from "@/lib/types";

const state = vi.hoisted(() => {
  const originalEnvironment = {
    encryptionKey: process.env.APP_ENCRYPTION_KEY,
    clientId: process.env.PLAID_CLIENT_ID,
    secret: process.env.PLAID_SECRET,
    plaidEnv: process.env.PLAID_ENV,
  };
  process.env.APP_ENCRYPTION_KEY = "c".repeat(64);

  return {
    originalEnvironment,
    session: {
      current: {
        id: "usr_plaid",
        username: "ada",
        sessionVersion: 3,
      } as {
        id: string;
        username: string;
        sessionVersion: number;
      } | null,
    },
    createLinkToken: vi.fn(),
    exchangePublicToken: vi.fn(),
    store: {
      sessionVersion: vi.fn(),
      listConnectionCredentialRecords: vi.fn(),
      createConnection: vi.fn(),
      syncConnection: vi.fn(),
    },
  };
});

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    requireSession: vi.fn(async () => {
      if (!state.session.current) throw new actual.SessionRequiredError();
      return state.session.current;
    }),
  };
});

vi.mock("@/lib/server/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/store")>();
  return { ...actual, store: state.store };
});

vi.mock("@/lib/providers/plaid", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/plaid")>();
  return {
    ...actual,
    createLinkToken: state.createLinkToken,
    exchangePublicToken: state.exchangePublicToken,
  };
});

const { encryptCredentials, decryptCredentials } = await import(
  "@/lib/server/secrets"
);
const { POST: linkToken } = await import(
  "@/app/api/plaid/link-token/route"
);
const { POST: exchange } = await import("@/app/api/plaid/exchange/route");

const CLIENT_CREDENTIALS = {
  clientId: "client-saved",
  secret: "secret-saved",
  env: "sandbox" as const,
};

const CONNECTION: Connection = {
  id: "con_plaid",
  provider: "plaid",
  institution: "First National",
  status: "ok",
  lastSyncAt: null,
  createdAt: "2026-07-28T12:00:00.000Z",
};

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function savedRecord(credentials = CLIENT_CREDENTIALS) {
  return {
    connection: {
      ...CONNECTION,
      id: "con_credentials",
      institution: null,
    },
    encryptedCredentials: encryptCredentials(credentials),
  };
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.session.current = {
    id: "usr_plaid",
    username: "ada",
    sessionVersion: 3,
  };
  state.store.sessionVersion.mockResolvedValue(3);
  state.store.listConnectionCredentialRecords.mockResolvedValue([]);
  state.store.createConnection.mockResolvedValue(CONNECTION);
  state.store.syncConnection.mockResolvedValue({ added: 2, modified: 0 });
  state.createLinkToken.mockResolvedValue({
    linkToken: "link-sandbox-token",
    expiration: "2026-07-28T12:30:00.000Z",
  });
  state.exchangePublicToken.mockResolvedValue({
    accessToken: "access-sandbox-token",
    itemId: "item-1",
  });
  delete process.env.PLAID_CLIENT_ID;
  delete process.env.PLAID_SECRET;
  delete process.env.PLAID_ENV;
});

afterAll(() => {
  const original = state.originalEnvironment;
  restore("APP_ENCRYPTION_KEY", original.encryptionKey);
  restore("PLAID_CLIENT_ID", original.clientId);
  restore("PLAID_SECRET", original.secret);
  restore("PLAID_ENV", original.plaidEnv);
});

describe("POST /api/plaid/link-token", () => {
  it("returns 401 without a live session", async () => {
    state.session.current = null;

    const response = await linkToken();

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
    expect(state.createLinkToken).not.toHaveBeenCalled();
  });

  it("returns a clear error when Plaid is unconfigured", async () => {
    const response = await linkToken();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "PLAID_NOT_CONFIGURED",
        message:
          "Configure Plaid client credentials in Settings or set PLAID_CLIENT_ID and PLAID_SECRET.",
      },
    });
  });

  it("uses saved credentials before environment fallback", async () => {
    process.env.PLAID_CLIENT_ID = "client-env";
    process.env.PLAID_SECRET = "secret-env";
    process.env.PLAID_ENV = "production";
    state.store.listConnectionCredentialRecords.mockResolvedValue([
      savedRecord(),
    ]);

    const response = await linkToken();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      linkToken: "link-sandbox-token",
    });
    expect(state.createLinkToken).toHaveBeenCalledWith(CLIENT_CREDENTIALS, {
      clientUserId: "usr_plaid",
    });
  });
});

describe("POST /api/plaid/exchange", () => {
  it.each([
    {},
    { publicToken: "" },
    { publicToken: 42 },
    { publicToken: "public-token", institution: { name: "Missing id" } },
    { publicToken: "public-token", unexpected: true },
  ])("zod-rejects an invalid body: %j", async (payload) => {
    const response = await exchange(
      jsonRequest("/api/plaid/exchange", payload),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(state.exchangePublicToken).not.toHaveBeenCalled();
    expect(state.store.createConnection).not.toHaveBeenCalled();
  });

  it("seals the access token, creates the connection, and triggers sync", async () => {
    state.store.listConnectionCredentialRecords.mockResolvedValue([
      savedRecord(),
    ]);

    const response = await exchange(
      jsonRequest("/api/plaid/exchange", {
        publicToken: "public-sandbox-token",
        institution: {
          institution_id: "ins_1",
          name: "First National",
        },
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(CONNECTION);
    expect(state.exchangePublicToken).toHaveBeenCalledWith(
      CLIENT_CREDENTIALS,
      "public-sandbox-token",
    );
    expect(state.store.createConnection).toHaveBeenCalledOnce();

    const [provider, storedBlob, institution] =
      state.store.createConnection.mock.calls[0];
    expect(provider).toBe("plaid");
    expect(institution).toBe("First National");
    expect(storedBlob).toMatch(/^v1:/);
    expect(storedBlob).not.toContain("access-sandbox-token");
    expect(storedBlob).not.toContain("secret-saved");
    expect(storedBlob).not.toContain("public-sandbox-token");
    expect(decryptCredentials(storedBlob)).toEqual({
      ...CLIENT_CREDENTIALS,
      accessToken: "access-sandbox-token",
    });
    expect(state.store.syncConnection).toHaveBeenCalledWith(CONNECTION.id);
  });
});

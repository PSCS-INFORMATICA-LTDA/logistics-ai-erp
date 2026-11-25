import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { executePscsOneCallback } from "../src/lib/pscs-one/callbackFlow.ts";
import { publicPscsOneSsoReason } from "../src/lib/pscs-one/errors.ts";
import { PscsOneSessionAdapter } from "../src/lib/pscs-one/sessionAdapter.ts";
import type { PscsOneIdentityV1 } from "../src/lib/pscs-one/types.ts";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const AUTH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AUTH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COMPANY_A = "92c4c90d-6856-4c41-a9a1-9eba6a7468f6";
const COMPANY_B = "bcd3c6c9-0e4a-4356-addd-4af925725576";
const CORE_A = "c0910000-0000-4000-8000-0000000000a1";
const CORE_B = "c0b00000-0000-4000-8000-00000000000b";
const MIGRATION_094 = "5fc0db367325efdf5d5ae978e4c9d4fb73363e13fee2c426850049466b687032";

type ProfileRow = {
  id: string;
  email: string | null;
  full_name?: string;
  pscs_one_user_id: string | null;
};

type AuthRow = {
  id: string;
  email: string;
  email_confirmed_at: string | null;
};

type Write = { op: "update" | "insert"; values: Record<string, unknown>; id?: string };

function identity(overrides: Partial<PscsOneIdentityV1> = {}): PscsOneIdentityV1 {
  return {
    version: "1",
    user_id: USER_A,
    email: "ana@empresa-a.test",
    company_id: CORE_A,
    product_key: "logistics_ai",
    external_company_id: COMPANY_A,
    environment: "development",
    ...overrides,
  };
}

function directory(initial?: { profiles?: ProfileRow[]; users?: AuthRow[] }) {
  const profiles = initial?.profiles ?? [];
  const users = initial?.users ?? [];
  const writes: Write[] = [];
  const lookups: string[] = [];
  const links: string[] = [];

  const admin = {
    from(table: string) {
      if (table !== "profiles") throw new Error(`unexpected_table_${table}`);
      return {
        select() {
          return {
            eq(column: string, value: string) {
              lookups.push(column);
              if (column === "email") throw new Error("profiles_email_not_authoritative");
              return {
                async maybeSingle() {
                  const rows = profiles.filter((row) => row[column as "id" | "pscs_one_user_id"] === value);
                  if (rows.length > 1) return { data: null, error: { message: "multiple rows" } };
                  return { data: rows[0] ?? null, error: null };
                },
              };
            },
          };
        },
        update(values: Record<string, unknown>) {
          return {
            eq(column: string, value: string) {
              if (column !== "id") throw new Error("unexpected_update_column");
              writes.push({ op: "update", values, id: value });
              const row = profiles.find((profile) => profile.id === value);
              if (row) Object.assign(row, values);
              return Promise.resolve({ error: null });
            },
          };
        },
        insert(values: ProfileRow) {
          writes.push({ op: "insert", values });
          profiles.push(values);
          return Promise.resolve({ error: null });
        },
      };
    },
    auth: {
      admin: {
        async listUsers({ page, perPage }: { page: number; perPage: number }) {
          const start = (page - 1) * perPage;
          return { data: { users: users.slice(start, start + perPage) }, error: null };
        },
        async getUserById(id: string) {
          const user = users.find((row) => row.id === id) ?? null;
          return { data: { user }, error: user ? null : { message: "user_not_found" } };
        },
        async createUser(input: { email: string; email_confirm?: boolean }) {
          if (input.email_confirm !== true) throw new Error("email_confirm_required");
          const user = {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            email: input.email,
            email_confirmed_at: "2026-11-25T16:00:00Z",
          };
          users.push(user);
          return { data: { user }, error: null };
        },
        async generateLink(input: { email: string }) {
          links.push(input.email);
          return { data: { properties: { hashed_token: `hash-${input.email}` } }, error: null };
        },
      },
    },
  };

  return { admin, profiles, users, writes, lookups, links };
}

describe("associação SSO pelo e-mail confirmado do Auth", () => {
  it("associa um usuário confirmado e ignora o e-mail editável do perfil", async () => {
    const state = directory({
      users: [
        ...Array.from({ length: 200 }, (_, index) => ({
          id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          email: `other-${index}@example.test`,
          email_confirmed_at: "2026-11-25T16:00:00Z",
        })),
        { id: AUTH_A, email: "Ana@Empresa-A.test", email_confirmed_at: "2026-11-25T16:00:00Z" },
      ],
      profiles: [
        { id: AUTH_A, email: "alterado-por-usuario@example.test", pscs_one_user_id: null },
        { id: AUTH_B, email: "ana@empresa-a.test", pscs_one_user_id: null },
      ],
    });

    const local = await PscsOneSessionAdapter.ensureLocalUser(identity(), state.admin as never);

    assert.equal(local.authUserId, AUTH_A);
    assert.equal(local.email, "ana@empresa-a.test");
    assert.equal(local.tokenHash, "hash-ana@empresa-a.test");
    assert.equal(state.profiles.find((row) => row.id === AUTH_A)?.pscs_one_user_id, USER_A);
    assert.equal(state.profiles.find((row) => row.id === AUTH_A)?.email, "ana@empresa-a.test");
    assert.equal(state.profiles.find((row) => row.id === AUTH_B)?.pscs_one_user_id, null);
    assert.deepEqual(state.lookups, ["pscs_one_user_id", "id"]);
    assert.equal(state.links[0], "ana@empresa-a.test");
  });

  it("preserva o vínculo existente e recusa divergência de e-mail confirmado", async () => {
    const state = directory({
      users: [{ id: AUTH_A, email: "ana@empresa-a.test", email_confirmed_at: "2026-11-25T16:00:00Z" }],
      profiles: [{ id: AUTH_A, email: "spoof@example.test", pscs_one_user_id: USER_A }],
    });

    const local = await PscsOneSessionAdapter.ensureLocalUser(identity(), state.admin as never);
    assert.equal(local.authUserId, AUTH_A);
    assert.equal(state.profiles[0].pscs_one_user_id, USER_A);
    assert.equal(state.profiles[0].email, "ana@empresa-a.test");
    assert.equal("pscs_one_user_id" in state.writes[0].values, false);

    await assert.rejects(
      () => PscsOneSessionAdapter.ensureLocalUser(identity({ email: "outro@empresa-b.test" }), state.admin as never),
      /identity_conflict/,
    );
    assert.equal(state.profiles[0].pscs_one_user_id, USER_A);
    assert.equal(state.writes.length, 1);
  });

  it("recusa e-mail duplicado, e-mail não confirmado e vínculo de outra identidade", async () => {
    const duplicated = directory({
      users: [
        { id: AUTH_A, email: "ana@empresa-a.test", email_confirmed_at: "2026-11-25T16:00:00Z" },
        { id: AUTH_B, email: "ana@empresa-a.test", email_confirmed_at: "2026-11-25T16:00:00Z" },
      ],
    });
    await assert.rejects(
      () => PscsOneSessionAdapter.ensureLocalUser(identity(), duplicated.admin as never),
      /duplicate_auth_email/,
    );
    assert.equal(duplicated.writes.length, 0);

    const unverified = directory({
      users: [{ id: AUTH_A, email: "ana@empresa-a.test", email_confirmed_at: null }],
    });
    await assert.rejects(
      () => PscsOneSessionAdapter.ensureLocalUser(identity(), unverified.admin as never),
      /auth_email_unverified/,
    );
    assert.equal(unverified.users.length, 1);
    assert.equal(unverified.writes.length, 0);

    const occupied = directory({
      users: [{ id: AUTH_A, email: "ana@empresa-a.test", email_confirmed_at: "2026-11-25T16:00:00Z" }],
      profiles: [{ id: AUTH_A, email: "ana@empresa-a.test", pscs_one_user_id: USER_B }],
    });
    await assert.rejects(
      () => PscsOneSessionAdapter.ensureLocalUser(identity(), occupied.admin as never),
      /identity_conflict/,
    );
    assert.equal(occupied.profiles[0].pscs_one_user_id, USER_B);
    assert.equal(occupied.writes.length, 0);
  });

  it("cria o usuário com o e-mail confirmado pelo Auth quando não há conta local", async () => {
    const state = directory();
    const local = await PscsOneSessionAdapter.ensureLocalUser(identity(), state.admin as never);
    assert.equal(local.authUserId, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    assert.equal(local.email, "ana@empresa-a.test");
    assert.equal(state.users[0].email_confirmed_at, "2026-11-25T16:00:00Z");
    assert.equal(state.profiles[0].pscs_one_user_id, USER_A);
    assert.equal(state.profiles[0].email, "ana@empresa-a.test");
  });

  it("isola a associação da empresa e não reutiliza o usuário da outra empresa", async () => {
    const state = directory({
      users: [
        { id: AUTH_A, email: "ana@empresa-a.test", email_confirmed_at: "2026-11-25T16:00:00Z" },
        { id: AUTH_B, email: "bruno@empresa-b.test", email_confirmed_at: "2026-11-25T16:00:00Z" },
      ],
      profiles: [
        { id: AUTH_A, email: "ana@empresa-a.test", pscs_one_user_id: null },
        { id: AUTH_B, email: "ana@empresa-a.test", pscs_one_user_id: null },
      ],
    });
    const memberships: Array<{ authUserId: string; companyId: string }> = [];

    const first = await executePscsOneCallback(
      { code: "code-a", origin: "https://logistics-ai-erp-dev.vercel.app" },
      {
        exchangeAuthorizationCode: async () => ({ identity: identity() }),
        ensureLocalUser: (value) => PscsOneSessionAdapter.ensureLocalUser(value, state.admin as never),
        ensureMembership: async (authUserId, companyId) => {
          memberships.push({ authUserId, companyId });
        },
        verifySession: async () => ({ accessTokenPresent: true, refreshTokenPresent: true }),
        writeCookies: () => undefined,
      },
    );
    const second = await executePscsOneCallback(
      { code: "code-b", origin: "https://logistics-ai-erp-dev.vercel.app" },
      {
        exchangeAuthorizationCode: async () => ({
          identity: identity({
            user_id: USER_B,
            email: "bruno@empresa-b.test",
            company_id: CORE_B,
            external_company_id: COMPANY_B,
          }),
        }),
        ensureLocalUser: (value) => PscsOneSessionAdapter.ensureLocalUser(value, state.admin as never),
        ensureMembership: async (authUserId, companyId) => {
          memberships.push({ authUserId, companyId });
        },
        verifySession: async () => ({ accessTokenPresent: true, refreshTokenPresent: true }),
        writeCookies: () => undefined,
      },
    );

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.deepEqual(memberships, [
      { authUserId: AUTH_A, companyId: COMPANY_A },
      { authUserId: AUTH_B, companyId: COMPANY_B },
    ]);
    assert.equal(state.profiles.find((row) => row.id === AUTH_A)?.pscs_one_user_id, USER_A);
    assert.equal(state.profiles.find((row) => row.id === AUTH_B)?.pscs_one_user_id, USER_B);
    assert.equal(publicPscsOneSsoReason(new Error("duplicate_auth_email")), "duplicate_auth_email");
    assert.equal(publicPscsOneSsoReason(new Error("auth_email_unverified")), "auth_email_unverified");
  });

  it("preserva o hash da migration 094", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const hash = createHash("sha256")
      .update(readFileSync(path.join(root, "supabase/pending/094_protect_pscs_one_user_id.sql")))
      .digest("hex");
    assert.equal(hash, MIGRATION_094);
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const userId = "00000000-0000-4000-8000-000000000001";
const adminId = "00000000-0000-4000-8000-000000000002";
const profile = {
  id: userId, nome_completo: "Nome Teste", rg_id: "12345", base: "Delta",
  ala: "Bravo", email: "usuario@example.test", perfil: "usuario", ativo: true,
};

function loadModule(path, dependencies) {
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const loaded = { exports: {} };
  vm.runInNewContext(outputText, {
    module: loaded, exports: loaded.exports, console,
    require: (name) => dependencies[name] ?? require(name),
  }, { filename: path });
  return loaded.exports;
}

function sessionFor({ signedIn = true, active = true, admin = false, lookupError = null, missing = false } = {}) {
  const supabase = {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: userId } : null }, error: null }) },
    from: (table) => {
      assert.equal(table, "profiles");
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: missing ? null : { perfil: admin ? "administrador" : "usuario", ativo: active },
              error: lookupError,
            }),
          }),
        }),
      };
    },
  };
  return loadModule("lib/supabase/admin.ts", {
    "@/lib/supabase/server": { createClient: async () => supabase },
  });
}

function adminFixture() {
  const writes = [];
  const client = {
    from: (table) => {
      assert.equal(table, "profiles");
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }) }),
        update: (values) => ({
          eq: async (key, id) => {
            writes.push({ operation: "update", values, key, id });
            return { error: null };
          },
        }),
        upsert: async (values) => {
          writes.push({ operation: "upsert", values });
          return { error: null };
        },
      };
    },
    rpc: async (name, values) => {
      writes.push({ operation: name, values });
      return { error: null };
    },
    auth: {
      admin: {
        createUser: async () => ({ data: { user: { id: userId } }, error: null }),
        getUserById: async () => ({ data: { user: { id: userId, email: profile.email } }, error: null }),
        updateUserById: async (id, values) => {
          writes.push({ operation: "auth-update", id, values });
          return { error: null };
        },
      },
    },
  };
  return { client, writes };
}

function loadRoute(path, session, clientFactory) {
  return loadModule(path, {
    "@/lib/supabase/admin": session,
    "@/lib/supabase/admin-server": { createSupabaseAdminClient: clientFactory },
  });
}

test("Meu Perfil carrega e mostra os dados sem campos ou ações de edição", async () => {
  let queriedId;
  const { default: Page } = loadModule("app/protected/meu-perfil/page.tsx", {
    "@/lib/supabase/server": {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
        from: () => ({
          select: () => ({
            eq: (key, id) => {
              assert.equal(key, "id");
              queriedId = id;
              return { maybeSingle: async () => ({ data: profile, error: null }) };
            },
          }),
        }),
      }),
    },
  });
  const html = renderToStaticMarkup(await Page());
  assert.equal(queriedId, userId);
  for (const value of ["Nome Teste", "12345", "Delta", "Bravo", "usuario@example.test", "usuario", "Ativo"]) {
    assert.ok(html.includes(value), value);
  }
  assert.doesNotMatch(html, /<(input|select|textarea|button|form)\b/i);
  assert.match(html, /Dados somente para consulta/);
});

test("Meu Perfil incompleto orienta procurar administrador", async () => {
  const { default: Page } = loadModule("app/protected/meu-perfil/page.tsx", {
    "@/lib/supabase/server": {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
        from: () => ({
          select: () => ({ eq: () => ({
            maybeSingle: async () => ({ data: { ...profile, nome_completo: null }, error: null }),
          }) }),
        }),
      }),
    },
  });
  const html = renderToStaticMarkup(await Page());
  assert.match(html, /Procure um administrador/);
  assert.doesNotMatch(html, /Complete seus dados/);
});

for (const admin of [false, true]) {
  test(`PATCH Meu Perfil rejeita sessão ativa (${admin ? "admin" : "usuário"}) sem gravar`, async () => {
    const route = loadRoute("app/api/meu-perfil/route.ts", sessionFor({ admin }), () => assert.fail("Cliente privilegiado não deve ser criado"));
    const response = await route.PATCH();
    assert.equal(response.status, 403);
    assert.match((await response.json()).message, /somente para consulta/);
  });
}

for (const [options, status] of [
  [{ signedIn: false }, 401],
  [{ active: false }, 403],
  [{ missing: true }, 403],
]) {
  test(`PATCH Meu Perfil preserva rejeição da sessão ${JSON.stringify(options)}`, async () => {
    const route = loadRoute("app/api/meu-perfil/route.ts", sessionFor(options));
    assert.equal((await route.PATCH()).status, status);
  });
}

const adminRoutes = [
  { path: "app/api/usuarios/[id]/perfil/route.ts", method: "PATCH", body: { ...profile, perfil: "administrador" }, operation: "update" },
  { path: "app/api/usuarios/[id]/perfil/route.ts", method: "PATCH", body: { ...profile, email: "novo@example.test", perfil: "administrador" }, operation: "update" },
  { path: "app/api/usuarios/[id]/route.ts", method: "PATCH", body: { ativo: false }, operation: "guard_admin_update" },
  { path: "app/api/usuarios/[id]/route.ts", method: "PATCH", body: { ativo: true }, operation: null },
  { path: "app/api/usuarios/invite/route.ts", method: "POST", body: { ...profile, password: "senha-teste" }, operation: "upsert" },
  { path: "app/api/usuarios/[id]/senha/route.ts", method: "PATCH", body: { password: "nova-senha-teste" }, operation: "auth-update" },
];

for (const [index, config] of adminRoutes.entries()) {
  test(`Fluxo administrativo ${index}: usuário comum e admin inativo não acessam cliente privilegiado`, async () => {
    for (const options of [{ admin: false }, { admin: true, active: false }]) {
      const route = loadRoute(config.path, sessionFor(options), () => assert.fail("Acesso privilegiado indevido"));
      const request = new Request("https://app.example.test/api/usuarios", {
        method: config.method, body: JSON.stringify(config.body),
      });
      const response = await route[config.method](request, { params: Promise.resolve({ id: userId }) });
      assert.equal(response.status, 403);
    }
  });

  test(`Fluxo administrativo ${index}: administrador ativo continua autorizado`, async () => {
    const { client, writes } = adminFixture();
    if (config.operation === null) {
      client.from = () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...profile, ativo: false }, error: null }) }) }),
      });
    }
    const route = loadRoute(config.path, sessionFor({ admin: true }), () => client);
    const request = new Request("https://app.example.test/api/usuarios", {
      method: config.method, body: JSON.stringify(config.body),
    });
    const response = await route[config.method](request, { params: Promise.resolve({ id: userId }) });
    assert.equal(response.status, config.method === "POST" ? 201 : 200);
    assert.ok(writes.some((write) => write.operation === (config.operation ?? "guard_admin_update")));
    if (config.operation === "update") {
      const update = writes.find((write) => write.operation === "update");
      assert.equal(update.id, userId);
      assert.deepEqual(JSON.parse(JSON.stringify(update.values)), {
        nome_completo: profile.nome_completo, rg_id: profile.rg_id, email: config.body.email,
        base: profile.base, ala: profile.ala,
      });
      assert.ok(writes.some((write) => write.operation === "guard_admin_update"
        && write.values.new_perfil === "administrador"));
      if (config.body.email !== profile.email) {
        assert.ok(writes.some((write) => write.operation === "auth-update"
          && write.values.email === config.body.email));
      }
    }
  });
}

test("Migration PostgreSQL: leitura preservada, UPDATE direto rejeitado e escrita administrativa permitida", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS
        $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO authenticated;
      CREATE TABLE public.profiles (
        id uuid PRIMARY KEY, nome_completo text, rg_id text, base text, ala text,
        email text, perfil text, ativo boolean DEFAULT true
      );
      INSERT INTO public.profiles VALUES
        ('${userId}', 'Nome Teste', '12345', 'Delta', 'Bravo', 'usuario@example.test', 'usuario', true),
        ('${adminId}', 'Admin Teste', '54321', 'Delta', 'Alfa', 'admin@example.test', 'administrador', true);
      CREATE FUNCTION public.eh_administrador() RETURNS boolean
        LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
          SELECT EXISTS (
            SELECT 1 FROM public.profiles WHERE id = auth.uid() AND perfil = 'administrador' AND ativo
          )
        $$;
      ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
      CREATE POLICY usuario_visualiza_proprio_perfil ON public.profiles FOR SELECT
        TO authenticated USING (id = auth.uid());
      CREATE POLICY administrador_visualiza_perfis ON public.profiles FOR SELECT
        TO authenticated USING (eh_administrador());
      CREATE POLICY administrador_atualiza_perfis ON public.profiles FOR UPDATE
        TO authenticated USING (eh_administrador()) WITH CHECK (eh_administrador());
      CREATE POLICY usuario_atualiza_proprio_perfil ON public.profiles FOR UPDATE
        TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
      GRANT ALL ON public.profiles TO authenticated;
      GRANT UPDATE (nome_completo, rg_id, base, ala) ON public.profiles TO authenticated;
      GRANT UPDATE (email) ON public.profiles TO PUBLIC;
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${userId}', false);
      UPDATE public.profiles SET nome_completo = 'Antes' WHERE id = '${userId}';
      RESET ROLE;
      UPDATE public.profiles SET nome_completo = 'Nome Teste' WHERE id = '${userId}';
    `);
    await db.exec(readFileSync("supabase/migrations/preview_guard_admin_update.sql", "utf8"));
    await db.exec("GRANT EXECUTE ON FUNCTION public.guard_admin_update(uuid, boolean, text) TO authenticated;");
    const migration = readFileSync("supabase/migrations/202610080001_profiles_admin_only_writes.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);

    const { rows: policies } = await db.query("SELECT policyname FROM pg_policies WHERE tablename = 'profiles' ORDER BY policyname");
    assert.deepEqual(policies.map((row) => row.policyname), [
      "administrador_visualiza_perfis", "profiles_bloqueia_update_direto", "usuario_visualiza_proprio_perfil",
    ]);

    await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${userId}', false);`);
    const { rows } = await db.query("SELECT * FROM public.profiles");
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], profile);
    for (const [column, value] of [
      ["nome_completo", "'Novo'"], ["rg_id", "'999'"], ["base", "'Alfa'"], ["ala", "'Charlie'"],
      ["email", "'novo@example.test'"], ["perfil", "'administrador'"], ["ativo", "false"],
    ]) {
      await assert.rejects(db.query(`UPDATE public.profiles SET ${column} = ${value} WHERE id = '${userId}'`),
        (error) => error.code === "42501");
    }
    await assert.rejects(db.query(`SELECT public.guard_admin_update('${userId}', false, 'administrador')`),
      (error) => error.code === "42501");
    await assert.rejects(db.query(`DELETE FROM public.profiles WHERE id = '${userId}'`),
      (error) => error.code === "42501");
    await assert.rejects(db.query(`INSERT INTO public.profiles (id) VALUES ('00000000-0000-4000-8000-000000000003')`),
      (error) => error.code === "42501");

    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${adminId}', false);`);
    assert.equal((await db.query("SELECT * FROM public.profiles")).rows.length, 2);
    await assert.rejects(db.query(`UPDATE public.profiles SET nome_completo = 'Indevido' WHERE id = '${userId}'`),
      (error) => error.code === "42501");

    await db.exec("RESET ROLE; SET ROLE service_role;");
    await db.exec(`UPDATE public.profiles SET nome_completo = 'Editado pelo admin' WHERE id = '${userId}';`);
    await db.exec(`SELECT public.guard_admin_update('${userId}', false, NULL);`);
    await db.exec(`SELECT public.guard_admin_update('${userId}', true, NULL);`);
    await assert.rejects(db.query(`SELECT public.guard_admin_update('${adminId}', false, NULL)`),
      (error) => error.code === "P0001");
    await db.exec(`INSERT INTO public.profiles (id, nome_completo, perfil) VALUES
      ('00000000-0000-4000-8000-000000000003', 'Novo usuário', 'usuario');`);
    assert.deepEqual((await db.query(`SELECT nome_completo, ativo FROM public.profiles WHERE id = '${userId}'`)).rows[0], {
      nome_completo: "Editado pelo admin", ativo: true,
    });

    await db.exec(`
      RESET ROLE;
      ALTER TABLE public.profiles ADD COLUMN outro_dado text;
      SET ROLE authenticated;
    `);
    await assert.rejects(db.query(`UPDATE public.profiles SET outro_dado = 'Indevido' WHERE id = '${userId}'`),
      (error) => error.code === "42501");

    await db.exec(`
      RESET ROLE;
      GRANT UPDATE ON public.profiles TO authenticated;
      CREATE POLICY permissiva_futura ON public.profiles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
      SET ROLE authenticated;
    `);
    assert.equal((await db.query("UPDATE public.profiles SET nome_completo = 'Indevido' RETURNING id")).rows.length, 0);
  } finally {
    await db.close();
  }
});

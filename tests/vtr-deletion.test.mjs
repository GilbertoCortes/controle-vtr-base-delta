import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";

const require = createRequire(import.meta.url);
const vtrId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const recordId = "00000000-0000-4000-8000-000000000003";
const otherRecordId = "00000000-0000-4000-8000-000000000004";
const migration = readFileSync("supabase/migrations/202610080002_vtr_permanent_deletion.sql", "utf8");
const cleanup = readFileSync("supabase/migrations/202610080003_remove_vtr_archive_columns.sql", "utf8");
const answers = {
  km_atual: 100, combustivel: "Cheio", oleo_motor: "Bom", liquido_arrefecimento: "Bom",
  seta_dianteira_direita: "OK", seta_dianteira_esquerda: "OK",
  seta_traseira_direita: "OK", seta_traseira_esquerda: "OK",
  luz_freio: "OK", luz_alerta: "OK", farol_alto: "OK", farol_baixo: "OK", buzina: "OK",
  strobo: "OK", sirene: "OK", giroflex: "OK",
  retrovisor_direito: "Possui", retrovisor_esquerdo: "Possui",
  pneu_dianteiro_esquerdo: "OK", pneu_dianteiro_direito: "OK",
  pneu_traseiro_esquerdo: "OK", pneu_traseiro_direito: "OK",
  estepe: "Possui", triangulo: "Possui", chave_roda: "Possui",
};
const photos = [{ dataUrl: "data:image/jpeg;base64,/9j/2Q==" }];
const postRequest = (body) => new Request("https://app.example.test/api/viaturas", {
  method: "POST", body: JSON.stringify(body),
});

function loadModule(path, dependencies = {}, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const loaded = { exports: {} };
  vm.runInNewContext(outputText, {
    module: loaded, exports: loaded.exports, Request, console,
    require: (name) => dependencies[name] ?? require(name),
    ...globals,
  }, { filename: path });
  return loaded.exports;
}

const deletion = loadModule("lib/delete-viatura.ts");
const errorResponse = { message: "Falha simulada", code: "fixture" };

function clientFixture({ paths = [`${vtrId}/${recordId}/foto.jpg`], storageFailure = false, finishFailure = false, prepareFailure = false } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, params) => {
      calls.push({ name, id: params.target_id });
      if (name === "preparar_exclusao_vtr") {
        return { data: paths, error: prepareFailure ? { ...errorResponse, code: "P0002" } : null };
      }
      return { error: finishFailure ? errorResponse : null };
    },
    storage: {
      from: (bucket) => {
        assert.equal(bucket, "fotos-vtr");
        return {
          remove: async (batch) => {
            calls.push({ name: "remove", paths: batch });
            return { error: storageFailure ? errorResponse : null };
          },
        };
      },
    },
  };
}

test("Limpeza remove arquivos em lotes antes de apagar o banco", async () => {
  const paths = Array.from({ length: 205 }, (_, index) => `${vtrId}/${recordId}/${index}.jpg`);
  const client = clientFixture({ paths });
  await deletion.deleteViatura(client, vtrId);
  assert.deepEqual(client.calls.map((call) => call.name), [
    "preparar_exclusao_vtr", "remove", "remove", "remove", "concluir_exclusao_vtr",
  ]);
  assert.deepEqual(client.calls.filter((call) => call.name === "remove").map((call) => call.paths.length), [100, 100, 5]);
  assert.equal(client.calls.at(-1).id, vtrId);
});

test("VTR sem fotos também pode ser excluída", async () => {
  const client = clientFixture({ paths: [] });
  await deletion.deleteViatura(client, vtrId);
  assert.deepEqual(client.calls.map((call) => call.name), ["preparar_exclusao_vtr", "concluir_exclusao_vtr"]);
});

test("Falha no Storage não apaga banco nem informa sucesso; nova tentativa conclui", async () => {
  const client = clientFixture({ storageFailure: true });
  await assert.rejects(deletion.deleteViatura(client, vtrId), /não foi possível remover todas as fotos/);
  assert.ok(!client.calls.some((call) => call.name === "concluir_exclusao_vtr"));
  const retry = clientFixture();
  await deletion.deleteViatura(retry, vtrId);
  assert.equal(retry.calls.at(-1).name, "concluir_exclusao_vtr");
});

test("Falhas no banco e resposta inválida são explícitas", async () => {
  await assert.rejects(deletion.deleteViatura(clientFixture({ prepareFailure: true }), vtrId),
    (error) => error.status === 404);
  await assert.rejects(deletion.deleteViatura(clientFixture({ finishFailure: true }), vtrId),
    /exclusão ainda não foi concluída/);
  const invalid = clientFixture({ paths: null });
  await assert.rejects(deletion.deleteViatura(invalid, vtrId), /dados inválidos/);
  assert.equal(invalid.calls.length, 1);
});

function routeFixture({ signedIn = true, active = true, admin = true } = {}, client = clientFixture()) {
  const revalidated = [];
  const sessions = loadModule("lib/supabase/admin.ts", {
    "@/lib/supabase/server": {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: signedIn ? { id: otherId } : null }, error: null }) },
        from: () => ({
          select: () => ({ eq: () => ({
            maybeSingle: async () => ({
              data: { perfil: admin ? "administrador" : "usuario", ativo: active }, error: null,
            }),
          }) }),
        }),
      }),
    },
  });
  const route = loadModule("app/api/viaturas/[id]/route.ts", {
    "@/lib/supabase/admin": sessions,
    "@/lib/supabase/admin-server": { createSupabaseAdminClient: () => {
      assert.ok(admin && active && signedIn);
      return client;
    } },
    "@/lib/delete-viatura": deletion,
    "next/cache": { revalidatePath: (path) => revalidated.push(path) },
  });
  return { route, revalidated, client };
}

function request(body = { confirmacao: "EXCLUIR DEFINITIVAMENTE" }) {
  return new Request("https://app.example.test/api/viaturas", { method: "DELETE", body: JSON.stringify(body) });
}

for (const [options, expected] of [
  [{ admin: false }, 403], [{ active: false }, 403], [{ signedIn: false }, 401],
]) {
  test(`Requisição direta não autorizada é rejeitada: ${JSON.stringify(options)}`, async () => {
    const { route, client } = routeFixture(options);
    const response = await route.DELETE(request(), { params: Promise.resolve({ id: vtrId }) });
    assert.equal(response.status, expected);
    assert.equal(client.calls.length, 0);
  });
}

test("API exige confirmação explícita e UUID válido", async () => {
  for (const [body, id] of [[{}, vtrId], [{ confirmacao: false }, vtrId], [null, vtrId], [{ confirmacao: "EXCLUIR DEFINITIVAMENTE" }, "inválido"]]) {
    const { route, client } = routeFixture();
    assert.equal((await route.DELETE(request(body), { params: Promise.resolve({ id }) })).status, 400);
    assert.equal(client.calls.length, 0);
  }
});

test("API ADMIN só retorna sucesso e invalida listas após finalizar banco e Storage", async () => {
  const { route, revalidated } = routeFixture();
  const response = await route.DELETE(request(), { params: Promise.resolve({ id: vtrId }) });
  assert.equal(response.status, 200);
  assert.match((await response.json()).message, /excluídos permanentemente/);
  assert.deepEqual(revalidated, ["/protected", `/protected/viaturas/${vtrId}`]);

  const failed = routeFixture({}, clientFixture({ storageFailure: true }));
  assert.equal((await failed.route.DELETE(request(), { params: Promise.resolve({ id: vtrId }) })).status, 500);
  assert.deepEqual(failed.revalidated, []);
});

test("Botão exige confirmação literal; cancelar não envia requisição; comum não vê botão", async () => {
  let admin = true;
  let confirmed = false;
  const messages = [];
  const fetches = [];
  const { DeleteViaturaButton } = loadModule("components/delete-viatura-button.tsx", {
    react: { useState: (value) => [value, () => {}] },
    "next/navigation": { useRouter: () => ({ replace: () => {}, refresh: () => {} }) },
  }, {
    window: { confirm: (message) => { messages.push(message); return confirmed; }, setTimeout: (callback) => callback() },
    fetch: async (...args) => { fetches.push(args); return Response.json({ message: "OK" }); },
  });
  const tree = DeleteViaturaButton({ isAdmin: admin, viaturaId: vtrId });
  const button = tree.props.children[0];
  await button.props.onClick();
  assert.equal(fetches.length, 0);
  assert.equal(messages[0], "Esta ação excluirá permanentemente esta VTR, todo o seu histórico e todas as fotos vinculadas. Esta ação não poderá ser desfeita.");
  confirmed = true;
  await button.props.onClick();
  assert.equal(fetches[0][0], `/api/viaturas/${vtrId}`);
  assert.equal(fetches[0][1].method, "DELETE");
  admin = false;
  assert.equal(DeleteViaturaButton({ isAdmin: admin, viaturaId: vtrId }), null);
});

test("Área de removidas e API de restauração não existem", () => {
  assert.equal(existsSync("app/protected/removidas/page.tsx"), false);
  assert.equal(existsSync("app/api/viaturas/[id]/arquivamento/route.ts"), false);
  for (const path of ["app/protected/page.tsx", "app/protected/viaturas/[id]/page.tsx"]) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /arquivada|arquivamento|\/protected\/removidas|ArchiveViaturaButton/);
  }
});

async function runLegacyScript(confirm, deleted) {
  const { outputText } = ts.transpileModule(readFileSync("scripts/delete-legacy-vtrs.mjs", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, allowJs: true },
  });
  const dependencies = {
    "@supabase/supabase-js": {
      createClient: (url, key) => {
        assert.equal(url, "https://fixture.example.test");
        assert.equal(key, "fixture");
        return {
          from: (table) => {
            assert.equal(table, "viaturas");
            return {
              select: () => ({
                eq: (column, value) => {
                  assert.equal(column, "arquivada");
                  assert.equal(value, true);
                  return {
                    order: async () => ({
                      data: [{ id: vtrId, placa: "ABC1D23" }], error: null,
                    }),
                  };
                },
              }),
            };
          },
        };
      },
    },
    "../lib/delete-viatura.ts": { deleteViatura: async (_client, id) => deleted.push(id) },
  };
  const loaded = { exports: {} };
  await vm.runInNewContext(`(async () => { ${outputText} })()`, {
    module: loaded, exports: loaded.exports,
    require: (name) => {
      assert.ok(name in dependencies, `Import inesperado: ${name}`);
      return dependencies[name];
    },
    console: { table: () => {}, log: () => {} },
    process: {
      loadEnvFile: () => {},
      env: { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.example.test", SUPABASE_SECRET_KEY: "fixture" },
      argv: confirm ? ["node", "script", "--confirmar-exclusao-definitiva"] : ["node", "script"],
    },
  });
}

test("Limpeza legada: sem confirmação só consulta; com confirmação exclui somente VTRs arquivadas", async () => {
  const deleted = [];
  await runLegacyScript(false, deleted);
  assert.deepEqual(deleted, []);
  await runLegacyScript(true, deleted);
  assert.deepEqual(deleted, [vtrId]);
});

async function database(applyMigration = true) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$
      SELECT nullif(current_setting('request.jwt.claim.role', true), '')
    $$;
    GRANT USAGE ON SCHEMA auth, storage TO authenticated, service_role;
    CREATE TABLE public.profiles (id uuid PRIMARY KEY, perfil text, ativo boolean);
    INSERT INTO public.profiles VALUES ('${otherId}', 'administrador', true), ('${vtrId}', 'usuario', true);
    CREATE TABLE public.viaturas (
      id uuid PRIMARY KEY, placa text UNIQUE, tipo text, situacao text, quilometragem integer,
      arquivada boolean DEFAULT false, arquivada_em timestamptz, arquivada_por uuid
    );
    CREATE TABLE public.registros_vtr (
      id uuid PRIMARY KEY, viatura_id uuid CONSTRAINT registros_vtr_viatura_id_fkey REFERENCES public.viaturas(id) ON DELETE CASCADE,
      tipo_registro text, km integer
    );
    CREATE TABLE public.fotos_registro_vtr (
      id uuid PRIMARY KEY, registro_id uuid CONSTRAINT fotos_registro_vtr_registro_id_fkey REFERENCES public.registros_vtr(id) ON DELETE CASCADE,
      caminho_storage text
    );
    CREATE TABLE storage.objects (bucket_id text, name text, PRIMARY KEY (bucket_id, name));
    ALTER TABLE public.viaturas ENABLE ROW LEVEL SECURITY;
    CREATE POLICY leitura ON public.viaturas FOR SELECT TO authenticated USING (true);
    CREATE POLICY cadastro ON public.viaturas FOR INSERT TO authenticated WITH CHECK (true);
    CREATE POLICY atualizacao ON public.viaturas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
    CREATE POLICY exclusao ON public.viaturas FOR DELETE TO authenticated USING (true);
    GRANT ALL ON public.viaturas, public.registros_vtr, public.fotos_registro_vtr, public.profiles, storage.objects
      TO authenticated, service_role;
  `);
  if (applyMigration) await db.exec(migration);
  return db;
}

test("Migration aborta sem FKs em cascata ou com dependências adicionais não revisadas", async () => {
  for (const [sql, expected] of [
    [`ALTER TABLE public.registros_vtr DROP CONSTRAINT registros_vtr_viatura_id_fkey;
      ALTER TABLE public.registros_vtr ADD CONSTRAINT registros_vtr_viatura_id_fkey
      FOREIGN KEY (viatura_id) REFERENCES public.viaturas(id);`, /foreign keys/],
    ["CREATE TABLE public.dependencia_nao_revisada (viatura_id uuid REFERENCES public.viaturas(id) ON DELETE CASCADE);",
      /outras tabelas/],
  ]) {
    const db = await database(false);
    try {
      await db.exec(sql);
      await assert.rejects(db.exec(migration), expected);
      await db.exec("ROLLBACK;");
      assert.equal((await db.query("SELECT to_regclass('public.exclusoes_vtr') AS tabela")).rows[0].tabela, null);
    } finally {
      await db.close();
    }
  }
});

test("Migration transacional pode ser reaplicada e não altera schema storage", async () => {
  assert.match(migration, /^BEGIN;/);
  assert.match(migration.trim(), /COMMIT;$/);
  assert.doesNotMatch(migration, /bloquear_upload_vtr_em_exclusao|fotos_vtr_bloqueia_upload_em_exclusao/);
  assert.doesNotMatch(migration, /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|ALTER\s+TABLE|GRANT[\s\S]*?ON)\s+storage\./i);
  assert.doesNotMatch(migration, /(?:ON|TRIGGER)\s+storage\./i);
  const db = await database();
  try {
    await seed(db);
    await db.query(`SELECT public.preparar_exclusao_vtr('${vtrId}')`);
    const before = (await db.query("SELECT * FROM public.exclusoes_vtr")).rows;
    await db.exec("RESET ROLE;");
    await db.exec(migration);
    assert.deepEqual((await db.query("SELECT * FROM public.exclusoes_vtr")).rows, before);
    assert.equal((await db.query(`SELECT * FROM pg_trigger WHERE tgrelid = 'storage.objects'::regclass AND NOT tgisinternal`)).rows.length, 0);
    assert.equal((await db.query(`SELECT * FROM pg_policies WHERE policyname = 'viaturas_delete_somente_admin_ativo'`)).rows.length, 1);
  } finally {
    await db.close();
  }
});

test("Falha antes do COMMIT reverte todos os objetos e permissões da migration", async () => {
  const db = await database(false);
  const snapshot = async () => (await db.query(`
    SELECT 'table' AS tipo, c.relname AS nome,
      jsonb_build_object('rls', c.relrowsecurity, 'acl', c.relacl::text) AS definicao
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    UNION ALL
    SELECT 'function', p.proname,
      jsonb_build_object('definition', pg_get_functiondef(p.oid), 'acl', p.proacl::text)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'f'
    UNION ALL
    SELECT 'trigger', t.tgname, to_jsonb(pg_get_triggerdef(t.oid))
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
    UNION ALL
    SELECT 'policy', policyname, to_jsonb(p) FROM pg_policies p WHERE schemaname = 'public'
    ORDER BY tipo, nome
  `)).rows;
  try {
    const before = await snapshot();
    const failingMigration = migration.replace(/COMMIT;\s*$/, "SELECT 1 / 0;\nCOMMIT;");
    assert.notEqual(failingMigration, migration);
    await assert.rejects(db.exec(failingMigration), (error) => error.code === "22012");
    await assert.rejects(db.query("SELECT 1"), (error) => error.code === "25P02");
    await db.exec("ROLLBACK;");
    assert.deepEqual(await snapshot(), before);
    assert.equal((await db.query("SELECT to_regclass('public.exclusoes_vtr') AS tabela")).rows[0].tabela, null);
    await db.exec(migration);
    await db.exec(migration);
    assert.equal((await db.query("SELECT * FROM pg_policies WHERE policyname = 'viaturas_delete_somente_admin_ativo'")).rows.length, 1);
  } finally {
    await db.close();
  }
});

async function seed(db, situacao = "ativa") {
  await db.exec(`
    INSERT INTO public.viaturas (id, placa, tipo, situacao) VALUES
      ('${vtrId}', 'ABC1234', 'Viatura', '${situacao}'),
      ('${otherId}', 'DEF5678', 'Viatura', 'ativa');
    INSERT INTO public.registros_vtr VALUES
      ('${recordId}', '${vtrId}', 'checkin_inicial', 100),
      ('${otherRecordId}', '${otherId}', 'checkin_inicial', 200);
    INSERT INTO public.fotos_registro_vtr VALUES
      ('00000000-0000-4000-8000-000000000005', '${recordId}', '${vtrId}/${recordId}/foto.jpg'),
      ('00000000-0000-4000-8000-000000000006', '${otherRecordId}', '${otherId}/${otherRecordId}/foto.jpg');
    INSERT INTO storage.objects VALUES
      ('fotos-vtr', '${vtrId}/${recordId}/foto.jpg'),
      ('fotos-vtr', '${vtrId}/${recordId}/upload-sem-metadado.jpg'),
      ('fotos-vtr', '${otherId}/${otherRecordId}/foto.jpg'),
      ('outro-bucket', '${vtrId}/preservar.jpg');
    SELECT set_config('request.jwt.claim.role', 'service_role', false);
    SET ROLE service_role;
  `);
}

for (const situacao of ["ativa", "baixada"]) {
  test(`PostgreSQL: exclusão de VTR ${situacao} limpa histórico/fotos/arquivos e preserva outra VTR`, async () => {
    const db = await database();
    try {
      await seed(db, situacao);
      const client = {
        rpc: async (name, { target_id }) => {
          const { rows } = await db.query(`SELECT public.${name}($1) AS result`, [target_id]);
          return { data: rows[0].result, error: null };
        },
        storage: {
          from: (bucket) => ({
            remove: async (paths) => {
              assert.equal(bucket, "fotos-vtr");
              // Somente o mock do Storage apaga metadados; producao usa a API Storage.
              await db.query("DELETE FROM storage.objects WHERE bucket_id = $1 AND name = ANY($2::text[])", [bucket, paths]);
              return { error: null };
            },
          }),
        },
      };
      await deletion.deleteViatura(client, vtrId);
      assert.deepEqual((await db.query("SELECT id FROM public.viaturas")).rows, [{ id: otherId }]);
      assert.deepEqual((await db.query("SELECT viatura_id FROM public.registros_vtr")).rows, [{ viatura_id: otherId }]);
      assert.equal((await db.query("SELECT * FROM public.fotos_registro_vtr")).rows.length, 1);
      assert.equal((await db.query("SELECT * FROM public.exclusoes_vtr")).rows.length, 0);
      assert.deepEqual((await db.query("SELECT bucket_id, name FROM storage.objects ORDER BY bucket_id")).rows, [
        { bucket_id: "fotos-vtr", name: `${otherId}/${otherRecordId}/foto.jpg` },
        { bucket_id: "outro-bucket", name: `${vtrId}/preservar.jpg` },
      ]);
      await db.exec("RESET ROLE;");
      await db.exec(cleanup);
      assert.equal((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'viaturas' AND column_name LIKE 'arquivada%'")).rows.length, 0);
    } finally {
      await db.close();
    }
  });
}

test("PostgreSQL: sessão comum não pode chamar RPCs, alterar fila ou apagar VTR diretamente", async () => {
  const db = await database();
  try {
    await seed(db);
    await db.exec(`RESET ROLE; SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      SELECT set_config('request.jwt.claim.sub', '${vtrId}', false);`);
    for (const sql of [
      `SELECT public.preparar_exclusao_vtr('${vtrId}')`,
      `SELECT public.concluir_exclusao_vtr('${vtrId}')`,
      "SELECT * FROM public.exclusoes_vtr",
    ]) {
      await assert.rejects(db.query(sql), (error) => error.code === "42501");
    }
    assert.equal((await db.query(`DELETE FROM public.viaturas WHERE id = '${vtrId}' RETURNING id`)).rows.length, 0);
    assert.equal((await db.query("SELECT * FROM public.viaturas")).rows.length, 2);
  } finally {
    await db.close();
  }
});

test("PostgreSQL: operação pendente bloqueia registros, fotos e alterações em public; permite retomada", async () => {
  const db = await database();
  try {
    await seed(db);
    const first = (await db.query(`SELECT public.preparar_exclusao_vtr('${vtrId}') AS paths`)).rows[0].paths;
    assert.equal(first.length, 2);
    for (const sql of [
      `UPDATE public.viaturas SET situacao = 'baixada' WHERE id = '${vtrId}'`,
      `INSERT INTO public.registros_vtr VALUES ('00000000-0000-4000-8000-000000000007', '${vtrId}', 'baixa', 100)`,
      `INSERT INTO public.fotos_registro_vtr VALUES ('00000000-0000-4000-8000-000000000008', '${recordId}', '${vtrId}/${recordId}/nova.jpg')`,
      `SELECT public.concluir_exclusao_vtr('${vtrId}')`,
    ]) {
      await assert.rejects(db.query(sql), (error) => error.code === "55000");
    }
    await db.exec(`DELETE FROM storage.objects WHERE bucket_id = 'fotos-vtr' AND name = '${first[0]}';`);
    assert.deepEqual((await db.query(`SELECT public.preparar_exclusao_vtr('${vtrId}') AS paths`)).rows[0].paths, first);
    await db.query("DELETE FROM storage.objects WHERE bucket_id = 'fotos-vtr' AND name = ANY($1::text[])", [first]);
    await db.exec(`SELECT public.concluir_exclusao_vtr('${vtrId}'); SELECT public.concluir_exclusao_vtr('${vtrId}');`);
    assert.equal((await db.query(`SELECT * FROM public.viaturas WHERE id = '${vtrId}'`)).rows.length, 0);
  } finally {
    await db.close();
  }
});

test("PostgreSQL: caminho de foto inconsistente não apaga arquivos de outra VTR", async () => {
  const db = await database();
  try {
    await seed(db);
    await db.exec(`UPDATE public.fotos_registro_vtr SET caminho_storage = '${otherId}/${otherRecordId}/foto.jpg' WHERE registro_id = '${recordId}';`);
    await assert.rejects(db.query(`SELECT public.preparar_exclusao_vtr('${vtrId}')`), (error) => error.code === "23514");
    assert.equal((await db.query("SELECT * FROM public.exclusoes_vtr")).rows.length, 0);
    assert.equal((await db.query("SELECT * FROM storage.objects")).rows.length, 4);
  } finally {
    await db.close();
  }
});

test("PostgreSQL: remoção de campos antigos recusa VTR arquivada ou operação pendente", async () => {
  const db = await database();
  try {
    await seed(db);
    await db.exec(`RESET ROLE; UPDATE public.viaturas SET arquivada = true WHERE id = '${vtrId}';`);
    await assert.rejects(db.exec(cleanup), /limpeza administrativa/);
    await db.exec(`ROLLBACK; UPDATE public.viaturas SET arquivada = false WHERE id = '${vtrId}';
      SELECT public.preparar_exclusao_vtr('${vtrId}');`);
    await assert.rejects(db.exec(cleanup), /exclusoes pendentes/);
    await db.exec("ROLLBACK;");
    assert.equal((await db.query("SELECT * FROM public.viaturas")).rows.length, 2);
  } finally {
    await db.close();
  }
});

test("PostgreSQL: cadastro, baixa e recebimento normais continuam gravando após migrations", async () => {
  const db = await database();
  try {
    await db.exec(cleanup);
    await db.exec(`
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      SELECT set_config('request.jwt.claim.sub', '${otherId}', false);
      SET ROLE authenticated;
      INSERT INTO public.viaturas (id, placa, tipo, situacao, quilometragem)
        VALUES ('${vtrId}', 'ABC1234', 'Viatura', 'ativa', 100);
      INSERT INTO public.registros_vtr VALUES ('${recordId}', '${vtrId}', 'checkin_inicial', 100);
      INSERT INTO storage.objects VALUES ('fotos-vtr', '${vtrId}/${recordId}/entrada.jpg');
      INSERT INTO public.fotos_registro_vtr VALUES
        ('00000000-0000-4000-8000-000000000005', '${recordId}', '${vtrId}/${recordId}/entrada.jpg');
      INSERT INTO public.registros_vtr VALUES ('${otherRecordId}', '${vtrId}', 'baixa', 110);
      UPDATE public.viaturas SET situacao = 'baixada', quilometragem = 110 WHERE id = '${vtrId}';
      INSERT INTO storage.objects VALUES ('fotos-vtr', '${vtrId}/${otherRecordId}/baixa.jpg');
      INSERT INTO public.registros_vtr VALUES ('00000000-0000-4000-8000-000000000007', '${vtrId}', 'recebimento', 120);
      UPDATE public.viaturas SET situacao = 'ativa', quilometragem = 120 WHERE id = '${vtrId}';
      INSERT INTO storage.objects VALUES ('fotos-vtr', '${vtrId}/00000000-0000-4000-8000-000000000007/recebimento.jpg');
    `);
    assert.deepEqual((await db.query(`SELECT situacao, quilometragem FROM public.viaturas WHERE id = '${vtrId}'`)).rows[0],
      { situacao: "ativa", quilometragem: 120 });
    assert.equal((await db.query("SELECT * FROM public.registros_vtr")).rows.length, 3);
    // Preserva a remocao usada pelo rollback de um cadastro sem registros.
    await db.exec(`INSERT INTO public.viaturas (id, placa) VALUES ('${otherId}', 'DEF5678');
      DELETE FROM public.viaturas WHERE id = '${otherId}';`);
  } finally {
    await db.close();
  }
});

function apiDatabaseClient(db, files, { privileged = false, beforeUpload, afterUpload, beforeInsert, storageFailure = false } = {}) {
  async function query(sql, params) {
    if (!privileged) return db.query(sql, params);
    const { rows: [session] } = await db.query("SELECT current_user AS username, auth.role() AS role");
    assert.ok(["postgres", "authenticated", "service_role"].includes(session.username));
    await db.exec("RESET ROLE; SET ROLE service_role;");
    await db.query("SELECT set_config('request.jwt.claim.role', 'service_role', false)");
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec(`RESET ROLE; SET ROLE ${session.username};`);
      await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [session.role ?? ""]);
    }
  }
  return {
    rpc: async (name, { target_id }) => {
      assert.ok(["preparar_exclusao_vtr", "concluir_exclusao_vtr"].includes(name));
      const { rows } = await query(`SELECT public.${name}($1) AS result`, [target_id]);
      return { data: rows[0].result, error: null };
    },
    from: (table) => {
      assert.ok(["viaturas", "registros_vtr", "fotos_registro_vtr"].includes(table));
      let operation = "select";
      let values;
      let columns = "*";
      const filters = [];
      const builder = {
        select: (selection) => { columns = selection; return builder; },
        insert: (data) => { operation = "insert"; values = data; return builder; },
        update: (data) => { operation = "update"; values = data; return builder; },
        delete: () => { operation = "delete"; return builder; },
        eq: (key, value) => { filters.push([key, "=", value]); return builder; },
        ilike: (key, value) => { filters.push([key, "ILIKE", value]); return builder; },
        or: () => builder,
        single: async () => {
          try {
            const params = [];
            let sql;
            const param = (value) => {
              params.push(value && typeof value === "object" ? JSON.stringify(value) : value);
              return `$${params.length}`;
            };
            if (operation === "insert") {
              if (beforeInsert) await beforeInsert(table, values);
              sql = `INSERT INTO public.${table} (${Object.keys(values).join(", ")})
                VALUES (${Object.values(values).map(param).join(", ")}) RETURNING ${columns}`;
            } else {
              const where = filters.map(([key, operator, value]) => `${key} ${operator} ${param(value)}`).join(" AND ");
              if (operation === "update") {
                const assignments = Object.entries(values).map(([key, value]) => `${key} = ${param(value)}`).join(", ");
                sql = `UPDATE public.${table} SET ${assignments} WHERE ${where} RETURNING ${columns}`;
              } else if (operation === "delete") {
                sql = `DELETE FROM public.${table} WHERE ${where} RETURNING ${columns}`;
              } else {
                sql = `SELECT ${columns} FROM public.${table}${where ? ` WHERE ${where}` : ""}`;
              }
            }
            const { rows } = await query(sql, params);
            return { data: rows[0] ?? null, error: null };
          } catch (error) {
            return { data: null, error };
          }
        },
        maybeSingle: () => builder.single(),
        then: (resolve, reject) => builder.single().then(resolve, reject),
      };
      return builder;
    },
    storage: {
      from: (bucket) => ({
        upload: async (path, bytes) => {
          assert.equal(bucket, "fotos-vtr");
          if (beforeUpload) await beforeUpload(path);
          // DML apenas no schema simulado: representa a Storage API no teste local.
          await query("INSERT INTO storage.objects VALUES ($1, $2)", [bucket, path]);
          files.set(path, bytes);
          if (afterUpload) await afterUpload(path);
          return { error: null };
        },
        remove: async (paths) => {
          assert.equal(bucket, "fotos-vtr");
          if (storageFailure) return { error: errorResponse };
          await query("DELETE FROM storage.objects WHERE bucket_id = $1 AND name = ANY($2::text[])", [bucket, paths]);
          for (const path of paths) files.delete(path);
          return { error: null };
        },
      }),
    },
  };
}

async function handlerSchema(db) {
  await db.exec(cleanup);
  await db.exec(`
    ALTER TABLE public.viaturas ALTER COLUMN id SET DEFAULT gen_random_uuid();
    ALTER TABLE public.registros_vtr ALTER COLUMN id SET DEFAULT gen_random_uuid();
    ALTER TABLE public.fotos_registro_vtr ALTER COLUMN id SET DEFAULT gen_random_uuid();
    ALTER TABLE public.viaturas ADD COLUMN motivo_situacao text, ADD COLUMN atualizado_em timestamptz;
    ALTER TABLE public.registros_vtr
      ADD COLUMN combustivel text, ADD COLUMN oleo_motor text, ADD COLUMN liquido_arrefecimento text,
      ADD COLUMN checklist jsonb, ADD COLUMN usuario_id uuid, ADD COLUMN reparos_realizados boolean,
      ADD COLUMN descricao_reparos text, ADD COLUMN empresa text, ADD COLUMN responsavel_entrega text,
      ADD COLUMN cpf_responsavel_entrega text;
  `);
}

function handlerDependencies(client, adminClient, userId = otherId) {
  return {
    "@/lib/supabase/admin": {
      requireActiveSession: async () => ({
        ok: true, supabase: client, user: { id: userId }, isAdmin: userId === otherId,
      }),
    },
    "@/lib/rollback-vtr-operation": loadModule("lib/rollback-vtr-operation.ts", {
      "@/lib/supabase/admin-server": { createSupabaseAdminClient: () => adminClient },
    }),
    "@/lib/plate": loadModule("lib/plate.ts"),
    "@/lib/vtr-km": loadModule("lib/vtr-km.ts"),
    "next/cache": { revalidatePath: () => {} },
  };
}

test("Handlers reais: cadastrar, baixar, receber e excluir VTR com fotos após remover arquivamento", async () => {
  const db = await database();
  try {
    await handlerSchema(db);
    await db.exec(`
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      SELECT set_config('request.jwt.claim.sub', '${otherId}', false);
      SET ROLE authenticated;
    `);
    const files = new Map();
    const client = apiDatabaseClient(db, files);
    const dependencies = handlerDependencies(client, apiDatabaseClient(db, files, { privileged: true }));
    const cadastro = loadModule("app/api/viaturas/cadastro/route.ts", dependencies);
    const created = await cadastro.POST(postRequest({
      viatura: { placa: "ABC-1D23", tipo: "Viatura" },
      checkin: { answers, observacoes: "Entrada de teste", photos },
    }));
    assert.equal(created.status, 201, JSON.stringify(await created.json()));
    const id = (await db.query("SELECT id FROM public.viaturas")).rows[0].id;
    const baixa = loadModule("app/api/viaturas/[id]/baixa/route.ts", dependencies);
    const lowered = await baixa.POST(postRequest({
      answers: { ...answers, km_atual: 110 }, motivoObservacoes: "Manutenção", photos,
    }), { params: Promise.resolve({ id }) });
    assert.equal(lowered.status, 201, JSON.stringify(await lowered.json()));
    const recebimento = loadModule("app/api/viaturas/[id]/recebimento-oficina/route.ts", dependencies);
    const received = await recebimento.POST(postRequest({
      answers: { ...answers, km_atual: 120 }, reparosRealizados: "Sim", descricaoReparos: "Reparo de teste",
      empresa: "Oficina", responsavelEntrega: "Responsável", cpfResponsavelEntrega: "12345678901", photos,
    }), { params: Promise.resolve({ id }) });
    assert.equal(received.status, 201, JSON.stringify(await received.json()));
    assert.deepEqual((await db.query("SELECT situacao, quilometragem FROM public.viaturas")).rows,
      [{ situacao: "ativa", quilometragem: 120 }]);
    assert.equal((await db.query("SELECT * FROM public.registros_vtr")).rows.length, 3);
    assert.equal((await db.query("SELECT * FROM public.fotos_registro_vtr")).rows.length, 3);
    assert.equal(files.size, 3);
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.role', 'service_role', false); SET ROLE service_role;");
    const { route } = routeFixture({}, client);
    const removed = await route.DELETE(request(), { params: Promise.resolve({ id }) });
    assert.equal(removed.status, 200);
    for (const table of ["viaturas", "registros_vtr", "fotos_registro_vtr", "exclusoes_vtr"]) {
      assert.equal((await db.query(`SELECT * FROM public.${table}`)).rows.length, 0, table);
    }
    assert.equal((await db.query("SELECT * FROM storage.objects")).rows.length, 0);
    assert.equal(files.size, 0, "Arquivos físicos no mock de Storage também foram removidos");
  } finally {
    await db.close();
  }
});

async function ongoingOperationSchema(db, situacao) {
  await handlerSchema(db);
  await db.exec(`
    INSERT INTO public.viaturas (id, placa, tipo, situacao, quilometragem) VALUES
      ('${vtrId}', 'ABC1D23', 'Viatura', '${situacao}', 100),
      ('${otherId}', 'DEF4G56', 'Viatura', 'ativa', 100);
    INSERT INTO public.registros_vtr (id, viatura_id, tipo_registro, km, usuario_id)
      VALUES ('${otherRecordId}', '${otherId}', 'checkin_inicial', 100, '${otherId}');
    ALTER TABLE public.registros_vtr ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.fotos_registro_vtr ENABLE ROW LEVEL SECURITY;
    CREATE POLICY registros_leitura ON public.registros_vtr FOR SELECT TO authenticated USING (true);
    CREATE POLICY registros_insert ON public.registros_vtr FOR INSERT TO authenticated WITH CHECK (usuario_id = auth.uid());
    CREATE POLICY fotos_leitura ON public.fotos_registro_vtr FOR SELECT TO authenticated USING (true);
    CREATE POLICY fotos_insert ON public.fotos_registro_vtr FOR INSERT TO authenticated WITH CHECK (true);
    SELECT set_config('request.jwt.claim.role', 'authenticated', false);
    SELECT set_config('request.jwt.claim.sub', '${vtrId}', false);
    SET ROLE authenticated;
  `);
}

for (const operation of ["baixa", "recebimento-oficina"]) {
  for (const finishBeforeUpload of [false, true]) {
    test(`${operation}: upload após ${finishBeforeUpload ? "conclusão" : "início"} da exclusão é removido pelo rollback`, async () => {
      const db = await database();
      try {
        await ongoingOperationSchema(db, operation === "baixa" ? "ativa" : "baixada");
        const files = new Map();
        const adminClient = apiDatabaseClient(db, files, { privileged: true });
        let attempts = 0;
        const client = apiDatabaseClient(db, files, {
          beforeUpload: async () => {
            attempts++;
            if (finishBeforeUpload) {
              await deletion.deleteViatura(adminClient, vtrId);
            } else {
              await adminClient.rpc("preparar_exclusao_vtr", { target_id: vtrId });
            }
          },
        });
        const dependencies = handlerDependencies(client, adminClient, vtrId);
        const route = loadModule(`app/api/viaturas/[id]/${operation}/route.ts`, dependencies);
        const response = await route.POST(postRequest({
          answers: { ...answers, km_atual: 110 }, motivoObservacoes: "Manutenção", photos,
          reparosRealizados: "Não", empresa: "Oficina", responsavelEntrega: "Responsável",
          cpfResponsavelEntrega: "12345678901",
        }), { params: Promise.resolve({ id: vtrId }) });
        assert.equal(response.status, 500);
        assert.doesNotMatch((await response.json()).message, /limpeza automática ficou incompleta/);
        assert.equal(attempts, 1);
        assert.equal(files.size, 0);
        assert.equal((await db.query("SELECT * FROM storage.objects")).rows.length, 0);
        assert.equal((await db.query(`SELECT * FROM public.registros_vtr WHERE viatura_id = '${vtrId}'`)).rows.length, 0);
        assert.equal((await db.query("SELECT * FROM public.fotos_registro_vtr")).rows.length, 0);
        assert.equal((await db.query(`SELECT * FROM public.registros_vtr WHERE viatura_id = '${otherId}'`)).rows.length, 1);
        if (!finishBeforeUpload) await deletion.deleteViatura(adminClient, vtrId);
        assert.deepEqual((await db.query("SELECT id FROM public.viaturas")).rows, [{ id: otherId }]);
      } finally {
        await db.close();
      }
    });
  }
}

for (const failure of ["registro", "upload-com-resposta-perdida"]) {
  test(`Cadastro comum: rollback administrativo limitado ao cadastro criado (${failure})`, async () => {
    const db = await database();
    try {
      await ongoingOperationSchema(db, "ativa");
      const files = new Map();
      const adminClient = apiDatabaseClient(db, files, { privileged: true });
      const client = apiDatabaseClient(db, files, {
        beforeInsert: async (table) => {
          if (table === "registros_vtr" && failure === "registro") throw new Error("Falha simulada ao criar check-in.");
        },
        afterUpload: async () => {
          if (failure === "upload-com-resposta-perdida") throw new Error("Resposta perdida após persistir upload.");
        },
      });
      const route = loadModule("app/api/viaturas/cadastro/route.ts", handlerDependencies(client, adminClient, vtrId));
      const response = await route.POST(postRequest({
        viatura: { placa: "GHI-7J89", tipo: "Viatura" }, checkin: { answers, photos },
      }));
      assert.equal(response.status, 500);
      assert.match((await response.json()).message, /VTR recém-criada foi removida/);
      assert.deepEqual((await db.query("SELECT id FROM public.viaturas ORDER BY id")).rows, [{ id: vtrId }, { id: otherId }]);
      assert.equal((await db.query("SELECT * FROM public.registros_vtr")).rows.length, 1);
      assert.equal((await db.query("SELECT * FROM public.fotos_registro_vtr")).rows.length, 0);
      assert.equal((await db.query("SELECT * FROM storage.objects")).rows.length, 0);
      assert.equal(files.size, 0);
      // Nem uma VTR vazia pode ser excluida diretamente pelo usuario comum.
      assert.equal((await db.query(`DELETE FROM public.viaturas WHERE id = '${vtrId}' RETURNING id`)).rows.length, 0);
    } finally {
      await db.close();
    }
  });
}

test("Rollback rejeita caminhos de outra operação e informa falha da Storage API sem apagar histórico", async () => {
  const db = await database();
  try {
    await ongoingOperationSchema(db, "ativa");
    const files = new Map();
    const adminClient = apiDatabaseClient(db, files, { privileged: true, storageFailure: true });
    const { rollbackVtrOperation } = loadModule("lib/rollback-vtr-operation.ts", {
      "@/lib/supabase/admin-server": { createSupabaseAdminClient: () => adminClient },
    });
    assert.equal(await rollbackVtrOperation({
      viaturaId: otherId, registroId: otherRecordId, attemptedPaths: [`${vtrId}/${recordId}/foto.jpg`],
    }), false);
    assert.equal(await rollbackVtrOperation({
      viaturaId: otherId, registroId: otherRecordId, attemptedPaths: [`${otherId}/${otherRecordId}/foto.jpg`],
    }), false);
    assert.equal((await db.query(`SELECT * FROM public.registros_vtr WHERE id = '${otherRecordId}'`)).rows.length, 1);
  } finally {
    await db.close();
  }
});

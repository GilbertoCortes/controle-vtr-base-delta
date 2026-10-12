import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const viaturaId = "00000000-0000-4000-8000-000000000002";
const registroId = "00000000-0000-4000-8000-000000000004";

function load(path, dependencies = {}, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const loaded = { exports: {} };
  vm.runInNewContext(outputText, {
    module: loaded, exports: loaded.exports, Request, Response, console,
    require: (name) => dependencies[name] ?? require(name), ...globals,
  });
  return loaded.exports;
}

test("abertura, atualização e acessos concorrentes apenas consultam a retirada", async () => {
  for (const fase of [null, "fotos", "pronta", "selada", "cancelando", "autorizada"]) {
    const calls = [];
    const client = {
      from(table) {
        assert.ok(["viaturas", "retiradas_vtr"].includes(table));
        calls.push(table);
        return {
          select() { return this; }, eq() { return this; },
          async maybeSingle() {
            return { data: table === "viaturas"
              ? { id: viaturaId, placa: "ABC1D23", tipo: "Viatura" }
              : fase ? { registro_id: registroId, fase } : null, error: null };
          },
        };
      },
      rpc() { assert.fail("Abrir a página não pode executar RPC"); },
      storage: { from() { assert.fail("Abrir a página não pode acessar Storage"); } },
    };
    const page = load("app/protected/viaturas/[id]/retirada/page.tsx", {
      "next/navigation": { redirect: () => assert.fail("Administrador válido não redireciona") },
      "@/lib/supabase/admin": { getAdminSession: async () => ({ user: { id: "admin" }, isAdmin: true }) },
      "@/lib/supabase/admin-server": { createSupabaseAdminClient: () => client },
      "@/components/final-withdrawal": { FinalWithdrawal: () => null },
    });
    const views = await Promise.all(Array.from({ length: 3 }, () => {
      const shell = page.default({ params: Promise.resolve({ id: viaturaId }) });
      return shell.props.children.type(shell.props.children.props);
    }));
    assert.equal(calls.length, 6);
    for (const view of views) {
      const component = view.props.children[1];
      assert.deepEqual(JSON.parse(JSON.stringify(component.props.withdrawal)), fase ? { registroId, fase } : null);
    }
  }
});

test("rota exige administrador, confirmação explícita e ID da vistoria", async () => {
  const calls = [];
  let isAdmin = true;
  let failure = null;
  const route = load("app/api/viaturas/[id]/retirada/cancelar/route.ts", {
    "next/server": { NextResponse: { json: (value, options = {}) => Response.json(value, options) } },
    "next/cache": { revalidatePath: () => {} },
    "@/lib/supabase/admin": { requireActiveSession: async () => ({ ok: true, isAdmin }) },
    "@/lib/supabase/admin-server": { createSupabaseAdminClient: () => ({}) },
    "@/lib/cancel-vtr-withdrawal": { cancelVtrWithdrawal: async (_client, id, record) => {
      calls.push([id, record]); if (failure) throw new Error(failure);
    } },
  });
  const post = (body) => route.POST(new Request("https://app.test/cancelar", {
    method: "POST", body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: viaturaId }) });
  isAdmin = false;
  assert.equal((await post({ registroId, confirmacao: "CANCELAR RETIRADA" })).status, 403);
  isAdmin = true;
  for (const body of [{}, { registroId }, { registroId: viaturaId, confirmacao: "sim" }]) {
    assert.equal((await post(body)).status, 400);
  }
  assert.equal(calls.length, 0);
  failure = "WITHDRAWAL_ALREADY_AUTHORIZED";
  assert.equal((await post({ registroId, confirmacao: "CANCELAR RETIRADA" })).status, 409);
  failure = "WITHDRAWAL_CHANGED";
  assert.equal((await post({ registroId, confirmacao: "CANCELAR RETIRADA" })).status, 409);
  failure = null;
  assert.equal((await post({ registroId, confirmacao: "CANCELAR RETIRADA" })).status, 200);
  assert.deepEqual(calls.at(-1), [viaturaId, registroId]);
});

test("botão de cancelamento só envia após confirmação; fase autorizada não oferece botão", async () => {
  const state = [];
  const refs = [];
  let stateIndex = 0;
  let refIndex = 0;
  let confirmed = false;
  const requests = [];
  const { FinalWithdrawal } = load("components/final-withdrawal.tsx", {
    react: {
      useState(initial) { const i = stateIndex++; if (!(i in state)) state[i] = initial; return [state[i], (value) => { state[i] = value; }]; },
      useRef(initial) { const i = refIndex++; return refs[i] ??= { current: initial }; },
      useEffect() {},
    },
    "next/navigation": { useRouter: () => ({ replace() {}, refresh() {} }) },
    "@/components/initial-checkin-form": { InitialCheckinForm: () => null },
    "@/lib/final-report-download": {},
  }, {
    window: { confirm: () => confirmed },
    fetch: async (url, options) => { requests.push({ url, options }); return Response.json({}); },
  });
  const nodes = (node) => node?.props ? [node, ...nodes(node.props.children)]
    : Array.isArray(node) ? node.flatMap(nodes) : [];
  const render = (fase) => {
    state.length = 0; refs.length = 0;
    stateIndex = 0; refIndex = 0;
    return nodes(FinalWithdrawal({ viatura: { id: viaturaId, placa: "ABC1D23", tipo: "Viatura" }, withdrawal: { registroId, fase } }));
  };
  const button = render("fotos").find((node) => node.type === "button" && node.props.children === "CANCELAR RETIRADA");
  assert.ok(button);
  assert.equal(render("fotos").some((node) => node.type === "button" && node.props.children === "GERAR PDF COMPLETO"), false);
  assert.equal(render("pronta").some((node) => node.type === "button" && node.props.children === "GERAR PDF COMPLETO"), true);
  assert.equal(render("selada").some((node) => node.type === "button" && node.props.children === "GERAR PDF COMPLETO"), true);
  button.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 0);
  confirmed = true;
  button.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0].options.body), { registroId, confirmacao: "CANCELAR RETIRADA" });
  assert.equal(render("autorizada").some((node) => node.type === "button" && node.props.children === "CANCELAR RETIRADA"), false);
});

test("limpeza recusa caminhos de outra vistoria antes de tocar no Storage", async () => {
  const { cancelVtrWithdrawal } = load("lib/cancel-vtr-withdrawal.ts");
  let removed = false;
  const client = {
    rpc: async () => ({ data: [`${viaturaId}/${viaturaId}/foto.jpg`], error: null }),
    storage: { from: () => ({ remove: () => { removed = true; } }) },
  };
  await assert.rejects(cancelVtrWithdrawal(client, viaturaId, registroId), /Caminhos da vistoria inválidos/);
  assert.equal(removed, false);
});

test("falha parcial no Storage interrompe o cancelamento antes da conclusão no PostgreSQL", async () => {
  const { cancelVtrWithdrawal } = load("lib/cancel-vtr-withdrawal.ts");
  const paths = Array.from({ length: 101 }, (_, i) => `${viaturaId}/${registroId}/${i}.jpg`);
  const batches = [];
  let concluded = false;
  const client = {
    rpc: async (name, args) => {
      assert.equal(args.target_id, viaturaId);
      assert.equal(args.expected_registro_id, registroId);
      if (name === "concluir_cancelamento_retirada") concluded = true;
      return { data: paths, error: null };
    },
    storage: { from: (bucket) => {
      assert.equal(bucket, "fotos-vtr");
      return { remove: async (batch) => {
        batches.push(batch);
        return { error: batches.length === 2 ? new Error("Falha parcial") : null };
      } };
    } },
  };
  await assert.rejects(cancelVtrWithdrawal(client, viaturaId, registroId), /Falha parcial/);
  assert.deepEqual(batches.map((batch) => batch.length), [100, 1]);
  assert.equal(concluded, false);
});

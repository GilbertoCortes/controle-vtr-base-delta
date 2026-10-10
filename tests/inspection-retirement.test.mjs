import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";

const require = createRequire(import.meta.url);
const userId = "00000000-0000-4000-8000-000000000001";
const vtrId = "00000000-0000-4000-8000-000000000002";
const otherId = "00000000-0000-4000-8000-000000000003";
const root = process.cwd();
function load(path, overrides = {}, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const loaded = { exports: {} };
  vm.runInNewContext(outputText, {
    module: loaded, exports: loaded.exports, console, Buffer, Request, Response, Blob, File, TextDecoder,
    crypto: globalThis.crypto, setTimeout,
    require: (name) => {
      if (name in overrides) return overrides[name];
      if (name.startsWith("@/lib/")) return load(`${root}/${name.slice(2)}.ts`, overrides, globals);
      return require(name);
    },
    ...globals,
  });
  return loaded.exports;
}
const inspection = load("lib/vtr-inspection.ts");
const photoServer = load("lib/inspection-photos-server.ts");
const plate = load("lib/plate.ts");
const fields = inspection.inspectionFields("Viatura");
const answers = Object.fromEntries(Object.entries(fields).map(([key, options]) => [key, options[0]]));
answers.km_atual = 100;
const image = readFileSync("public/carro.png");
const requiredPhotos = inspection.inspectionCategories.filter((c) => c.value !== "avarias")
  .map((c) => ({ categoria: c.value, dataUrl: `data:image/png;base64,${image.toString("base64")}` }));

test("Relatório pagina além de 1.000 linhas e não aceita truncamento ou contagem inconsistente", async () => {
  const { readCompleteRows } = load("lib/supabase/read-complete.ts");
  const source = Array.from({ length: 1507 }, (_, id) => ({ id }));
  const offsets = [];
  const result = await readCompleteRows(async (from, to) => {
    offsets.push(from);
    return { data: source.slice(from, Math.min(to + 1, from + 123)), count: source.length, error: null };
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), source);
  assert.ok(offsets.length > 12);
  await assert.rejects(readCompleteRows(async () => ({ data: [], count: 10, error: null })), /incompleta/);
  await assert.rejects(readCompleteRows(async () => ({ data: source.slice(0, 10), count: null, error: null })), /totalidade/);
  let attempts = 0;
  await assert.rejects(readCompleteRows(async () => ({
    data: [{ id: attempts++ }], count: attempts === 1 ? 3 : 4, error: null,
  })), /mudaram/);
});

test("Placa estrita: posições Mercosul, maiúsculas, sem espaços/hífen/caracteres extras", () => {
  for (const value of ["KKK5K55", "kkk5k55"]) assert.equal(plate.isStrictMercosulPlate(value), true);
  for (const value of ["KKK5555", "KKK-5K55", " KKK5K55", "KKK5K55 ", "KKK 5K55", "KKK5K555", "K1K5K55", "KKKКK55"]) {
    assert.equal(plate.isStrictMercosulPlate(value), false, value);
  }
});

test("Fotos: seis obrigatórias exatas; avarias sem limite de quantidade; imagens e categoria válidas", () => {
  assert.equal(inspection.validateInspectionPhotos(requiredPhotos), null);
  for (let index = 0; index < 6; index++) {
    assert.ok(inspection.validateInspectionPhotos(requiredPhotos.filter((_, i) => i !== index)));
    assert.ok(inspection.validateInspectionPhotos([...requiredPhotos, requiredPhotos[index]]));
  }
  const avarias = Array.from({ length: 200 }, () => ({ ...requiredPhotos[0], categoria: "avarias" }));
  assert.equal(inspection.validateInspectionPhotos([...requiredPhotos, ...avarias]), null);
  assert.equal(photoServer.prepareInspectionPhotos([...requiredPhotos, ...avarias]).length, 206);
  assert.throws(() => photoServer.prepareInspectionPhotos([{ ...requiredPhotos[0], categoria: "inventada" }]));
  assert.throws(() => photoServer.prepareInspectionPhotos(requiredPhotos.map((p) => ({ ...p, dataUrl: "data:image/png;base64,YWJj" }))), /inválido/);
});

test("Pintura, Lataria e KM obrigatórios no checklist inicial/final", () => {
  assert.equal(inspection.validateInspectionAnswers(answers, "Viatura"), null);
  for (const field of ["pintura", "lataria", "km_atual"]) {
    assert.ok(inspection.validateInspectionAnswers({ ...answers, [field]: "" }, "Viatura"));
  }
  assert.ok(inspection.validateInspectionAnswers({ ...answers, pintura: "OK" }, "Viatura"));
  for (const km_atual of [true, [], {}, -1, 1.1, 2147483648, " "]) {
    assert.ok(inspection.validateInspectionAnswers({ ...answers, km_atual }, "Viatura"));
  }
});

test("Formulário compartilhado: câmera, substituição/remoção de foto única e avarias múltiplas", async () => {
  const state = []; const refs = [];
  let cursor = 0; let refCursor = 0;
  const { InitialCheckinForm } = load("components/initial-checkin-form.tsx", {
    react: {
      useEffect: () => {},
      useRef: (initial) => { const i = refCursor++; return refs[i] ??= { current: initial }; },
      useState: (initial) => {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], (next) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
      },
    },
    "next/navigation": { useRouter: () => ({}) },
    "@/lib/vtr-draft": {},
  }, {
    FileReader: class {
      readAsDataURL() { this.result = "data:image/jpeg;base64,/9j/2Q=="; this.onload(); }
    },
    window: { Image: class { width = 600; height = 400; async decode() {} } },
    document: { createElement: () => ({ getContext: () => ({ drawImage: () => {} }), toDataURL: () => "data:image/jpeg;base64,/9j/2Q==" }) },
  });
  const render = () => {
    cursor = 0; refCursor = 0;
    return InitialCheckinForm({ finalViatura: { id: vtrId, placa: "KKK5K55", tipo: "Viatura", situacao: "ativa" } });
  };
  const elements = (tree) => {
    const output = [];
    const visit = (el) => {
      if (Array.isArray(el)) el.forEach(visit);
      else if (el?.props) { output.push(el); visit(el.props.children); }
    };
    visit(tree); return output;
  };
  const section = (category) => elements(render()).find((el) => el.type === "fieldset" && el.key === category);
  const pick = async (category, names, camera = false) => {
    const inputs = elements(section(category)).filter((el) => el.type === "input");
    inputs[camera ? 0 : 1].props.onChange({ currentTarget: { value: "", files: names.map((name) => new File(["fixture"], name, { type: "image/jpeg" })) } });
    await new Promise((resolve) => setImmediate(resolve));
  };
  assert.equal(elements(section("frente")).find((el) => el.type === "input").props.capture, "environment");
  await pick("frente", ["primeira.jpg"], true);
  assert.equal(state[4].length, 1);
  await pick("frente", ["substituta.jpg", "extra.jpg"]);
  assert.equal(state[4].length, 1);
  assert.equal(state[4][0].name, "substituta.jpg");
  elements(section("frente")).find((el) => el.type === "button").props.onClick();
  assert.equal(state[4].length, 0);
  await pick("avarias", Array.from({ length: 30 }, (_, index) => `${index}.jpg`));
  await pick("avarias", ["mais-uma.jpg"], true);
  assert.equal(state[4].length, 31);
  assert.ok(state[4].every((photo) => photo.categoria === "avarias"));
});

test("API cadastro rejeita fotos/placa/checklist inválidos antes de escrever", async () => {
  const route = load("app/api/viaturas/cadastro/route.ts", {
    "@/lib/supabase/admin": { requireActiveSession: async () => ({
      ok: true, user: { id: userId }, supabase: { from: () => assert.fail("Nenhuma escrita/consulta nesta etapa") },
    }) },
    "@/lib/rollback-vtr-operation": { rollbackVtrOperation: () => assert.fail("Rollback inesperado") },
  });
  for (const body of [
    { viatura: { placa: "KKK-5K55", tipo: "Viatura" }, checkin: { answers, photos: requiredPhotos } },
    { viatura: { placa: "KKK5K55 ", tipo: "Viatura" }, checkin: { answers, photos: requiredPhotos } },
    { viatura: { placa: "KKK5K55", tipo: "Viatura" }, checkin: { answers, photos: requiredPhotos.slice(1) } },
    { viatura: { placa: "KKK5K55", tipo: "Viatura" }, checkin: { answers: { ...answers, lataria: null }, photos: requiredPhotos } },
  ]) {
    const response = await route.POST(new Request("https://app.test", { method: "POST", body: JSON.stringify(body) }));
    assert.equal(response.status, 400);
  }
});

test("APIs de vistoria, PDF completo e exclusão rejeitam usuário comum antes do acesso privilegiado", async () => {
  for (const [path, method] of [
    ["app/api/viaturas/[id]/vistoria-final/route.ts", "POST"],
    ["app/api/viaturas/[id]/relatorio-final/route.ts", "GET"],
    ["app/api/viaturas/[id]/route.ts", "DELETE"],
  ]) {
    const route = load(path, {
      "@/lib/supabase/admin": { requireActiveSession: async () => ({ ok: true, isAdmin: false, user: { id: userId } }) },
      "@/lib/supabase/admin-server": { createSupabaseAdminClient: () => assert.fail("Cliente administrativo indevido") },
      "@/lib/full-history-pdf": {},
      "next/cache": { revalidatePath: () => {} },
    });
    assert.equal((await route[method](new Request("https://app.test"), { params: Promise.resolve({ id: vtrId }) })).status, 403);
  }
});

    test("DELETE ADMIN exige recibo válido e confirmação PDF salvo, sem chamar limpeza antecipada", async () => {
      let authorizationCalls = 0;
      const route = load("app/api/viaturas/[id]/route.ts", {
        "@/lib/supabase/admin": { requireActiveSession: async () => ({ ok: true, isAdmin: true, user: { id: userId } }) },
        "@/lib/supabase/admin-server": { createSupabaseAdminClient: () => ({
          rpc: async () => { authorizationCalls++; return { error: new Error("Recibo inválido") }; },
        }) },
        "@/lib/delete-viatura": { deleteViatura: () => assert.fail("Limpeza não pode começar") },
        "next/cache": { revalidatePath: () => assert.fail("Não pode informar sucesso") },
      });
      for (const payload of [
        { confirmacao: "EXCLUIR DEFINITIVAMENTE" },
        { confirmacao: "EXCLUIR DEFINITIVAMENTE", recibo: "a".repeat(64), pdfSalvo: false },
        { confirmacao: "EXCLUIR DEFINITIVAMENTE", recibo: "a".repeat(64), pdfSalvo: true },
      ]) {
        const response = await route.DELETE(new Request("https://app.test", { method: "DELETE", body: JSON.stringify(payload) }), {
          params: Promise.resolve({ id: vtrId }),
        });
        assert.equal(response.status, 403);
      }
      assert.equal(authorizationCalls, 1);
    });

    test("Vistoria final: salva seis fotos e avarias; upload com resposta perdida limpa só a própria operação", async () => {
      for (const fails of [false, true]) {
        const uploaded = []; const inserted = []; const removed = []; const rpcs = [];
        const recordId = "00000000-0000-4000-8000-000000000004";
        const client = {
          from: (table) => table === "viaturas" ? {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: vtrId, tipo: "Viatura" }, error: null }) }) }),
          } : { insert: async (photo) => { inserted.push(photo); return { error: null }; } },
          rpc: async (name, params) => { rpcs.push({ name, params }); return { data: recordId, error: null }; },
          storage: { from: (bucket) => {
            assert.equal(bucket, "fotos-vtr");
            return {
              upload: async (path) => { uploaded.push(path); return { error: fails ? { message: "Resposta perdida" } : null }; },
              remove: async (paths) => { removed.push(...paths); return { error: null }; },
            };
          } },
        };
        const route = load("app/api/viaturas/[id]/vistoria-final/route.ts", {
          "@/lib/supabase/admin": { requireActiveSession: async () => ({ ok: true, isAdmin: true, user: { id: userId } }) },
          "@/lib/supabase/admin-server": { createSupabaseAdminClient: () => client },
          "next/cache": { revalidatePath: () => {} },
        });
        const incomplete = await route.POST(new Request("https://app.test", {
          method: "POST", body: JSON.stringify({ answers, photos: requiredPhotos.slice(1) }),
        }), { params: Promise.resolve({ id: vtrId }) });
        assert.equal(incomplete.status, 400);
        assert.equal(rpcs.length, 0);
        assert.equal(uploaded.length, 0);
        const response = await route.POST(new Request("https://app.test", {
          method: "POST", body: JSON.stringify({ answers, photos: [...requiredPhotos, { ...requiredPhotos[0], categoria: "avarias" }] }),
        }), { params: Promise.resolve({ id: vtrId }) });
        assert.equal(response.status, fails ? 500 : 201);
        if (!fails) {
          assert.equal(inserted.length, 7);
          assert.deepEqual(inserted.map((photo) => photo.categoria), [...requiredPhotos.map((photo) => photo.categoria), "avarias"]);
          assert.equal(rpcs.length, 2, "Salvar vistoria não sela/gera PDF/exclui VTR");
          assert.equal(rpcs.at(-1).name, "concluir_fotos_vistoria");
          assert.equal(removed.length, 0);
        } else {
          assert.deepEqual(removed, uploaded);
          assert.ok(removed.every((path) => path.startsWith(`${vtrId}/${recordId}/`)));
          assert.equal(rpcs.at(-1).name, "cancelar_vistoria_incompleta");
        }
      }
    });

    test("Relatório final: consultas em lote, fotos completas; qualquer informação essencial ausente impede recibo", async () => {
      for (const failure of [null, "registros_vtr", "fotos_registro_vtr", "profiles", "download", "seal", "receipt", "chronology", "upload-in-progress"]) {
        const calls = []; const downloaded = []; const updated = [];
        const records = ["checkin_inicial", "baixa", "recebimento", "vistoria_final"].map((tipo_registro, index) => ({
          id: `evento-${index}`, tipo_registro, usuario_id: userId, km: 100,
          criado_em: `2026-10-0${index + 1}T12:00:00Z`, checklist: answers,
        }));
        if (failure === "chronology") records[0].criado_em = "2026-11-01T00:00:00Z";
        const photos = records.flatMap((record, index) => (index === 3 ? requiredPhotos : [{ categoria: null }]).map((photo, n) => ({
          registro_id: record.id, caminho_storage: `${vtrId}/${record.id}/${n}.png`, categoria: photo.categoria, descricao: null,
        })));
        const client = {
          from: (table) => {
            const values = {
              retiradas_vtr: { registro_id: "evento-3", fase: failure === "upload-in-progress" ? "fotos" : "selada" }, viaturas: { id: vtrId, placa: "KKK5K55", tipo: "Viatura" },
              registros_vtr: records, fotos_registro_vtr: photos, profiles: [{ id: userId, nome_completo: "ADMIN" }],
            };
            let update = null;
            const execute = async () => {
              calls.push(table);
              if (update) updated.push(update);
              const error = table === failure || (update && failure === "receipt") ? new Error("Falha simulada") : null;
              return { data: update ? { viatura_id: vtrId } : values[table], error, count: Array.isArray(values[table]) ? values[table].length : null };
            };
            const builder = {
              select: () => builder, eq: () => builder, in: () => builder, order: () => builder,
              range: () => builder,
              update: (value) => { update = value; return builder; },
              single: execute, maybeSingle: execute, then: (resolve, reject) => execute().then(resolve, reject),
            };
            return builder;
          },
          rpc: async (name) => { assert.equal(name, "selar_vistoria_final"); return { error: failure === "seal" ? new Error("Falha simulada") : null }; },
          storage: { from: () => ({
            download: async (path) => {
              downloaded.push(path);
              return { data: new Blob([image]), error: failure === "download" ? new Error("Falha simulada") : null };
            },
          }) },
        };
        const route = load("app/api/viaturas/[id]/relatorio-final/route.ts", {
          "@/lib/supabase/admin": { requireActiveSession: async () => ({ ok: true, isAdmin: true, user: { id: userId } }) },
          "@/lib/supabase/admin-server": { createSupabaseAdminClient: () => client },
          "@/lib/full-history-pdf": {
            fullHistoryFileName: () => "HISTORICO_COMPLETO_KKK5K55.pdf",
            generateFullHistoryPdf: async (_viatura, events) => {
              assert.equal(events.length, 4);
              assert.equal(events.at(-1).registro.tipoRegistro, "vistoria_final");
              assert.equal(events.flatMap((event) => event.fotos).length, photos.length);
              return Buffer.from("%PDF-fixture");
            },
          },
        });
        const response = await route.GET(new Request("https://app.test"), { params: Promise.resolve({ id: vtrId }) });
        assert.equal(response.status, failure ? 500 : 200, failure);
        if (failure) assert.equal(response.headers.get("X-Relatorio-Recibo"), null);
        else {
          assert.equal(downloaded.length, 9);
          for (const table of ["registros_vtr", "fotos_registro_vtr", "profiles"]) assert.equal(calls.filter((t) => t === table).length, 1);
          assert.equal(updated.length, 1);
          assert.equal(updated[0].administrador_id, userId);
          assert.match(updated[0].pdf_hash, /^[a-f0-9]{64}$/);
        }
        assert.ok(calls.every((table) => ["retiradas_vtr", "viaturas", "registros_vtr", "fotos_registro_vtr", "profiles"].includes(table)));
      }
    });

test("Recepção do PDF exige Blob completo, assinatura, hash e recibo; rejeita fetch truncado", async () => {
  const { receiveFinalReport } = load("lib/final-report-download.ts");
  const pdf = Buffer.from("%PDF-1.3\nfixture\n%%EOF");
  const headers = {
    "Content-Type": "application/pdf", "Content-Length": String(pdf.length),
    "X-Relatorio-Bytes": String(pdf.length),
    "X-Relatorio-Recibo": "a".repeat(64), "X-Relatorio-SHA256": createHash("sha256").update(pdf).digest("hex"),
  };
  const result = await receiveFinalReport(new Response(pdf, { headers }));
  assert.equal(result.blob.size, pdf.length);
  for (const response of [
    new Response(pdf.subarray(0, 7), { headers }),
    new Response(pdf, { headers: { ...headers, "X-Relatorio-SHA256": "0".repeat(64) } }),
    new Response("erro", { status: 500 }),
    new Response("não é PDF", { headers }),
  ]) await assert.rejects(receiveFinalReport(response), /VTR não foi excluída/);
});

test("Mobile: compartilhar arquivo em gesto direto; cancelamento não autoriza exclusão", async () => {
  let shared = false;
  const browser = load("lib/final-report-download.ts", {}, {
    navigator: {
      canShare: ({ files }) => files.length === 1,
      share: async ({ files }) => { assert.equal(files[0].name, "HISTORICO_COMPLETO_KKK5K55.pdf"); shared = true; },
    },
  });
  await browser.initiateFinalReportDownload(new Blob(["%PDF-fixture"]), "HISTORICO_COMPLETO_KKK5K55.pdf");
  assert.equal(shared, true);
  const cancelled = load("lib/final-report-download.ts", {}, {
    navigator: { canShare: () => true, share: async () => { throw new Error("AbortError"); } },
  });
  await assert.rejects(cancelled.initiateFinalReportDownload(new Blob(["%PDF"]), "teste.pdf"), /AbortError/);
});

test("Download convencional inicia arquivo sob gesto; navegador sem suporte rejeita e preserva dados", async () => {
  let clicks = 0; let revocations = 0;
  for (const supported of [true, false]) {
    const anchor = {
      ...(supported ? { download: "" } : {}),
      click: () => { clicks++; },
      remove: () => {},
    };
    const browser = load("lib/final-report-download.ts", {}, {
      navigator: {},
      document: { createElement: () => anchor, body: { appendChild: () => {} } },
      URL: { createObjectURL: () => "blob:fixture", revokeObjectURL: () => { revocations++; } },
      setTimeout: (callback, delay) => { assert.equal(delay, 60_000); callback(); },
    });
    const promise = browser.initiateFinalReportDownload(new Blob(["%PDF"]), "HISTORICO_COMPLETO_KKK5K55.pdf");
    if (supported) {
      await promise;
      assert.equal(anchor.download, "HISTORICO_COMPLETO_KKK5K55.pdf");
      assert.equal(anchor.href, "blob:fixture");
    } else await assert.rejects(promise, /VTR não foi excluída/);
  }
  assert.equal(clicks, 1);
  assert.equal(revocations, 2);
});

test("Fluxo UI nunca chama DELETE antes de receber Blob, iniciar download e confirmar salvamento", async () => {
  const state = [];
  let cursor = 0;
  const requests = [];
  let downloadError = false;
  const { FinalWithdrawal } = load("components/final-withdrawal.tsx", {
    react: { useState: (initial) => {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (next) => { state[index] = next; }];
    } },
    "next/navigation": { useRouter: () => ({ replace: () => {}, refresh: () => {} }) },
    "@/components/initial-checkin-form": { InitialCheckinForm: "inspection-form" },
    "@/lib/final-report-download": {
      finalReportFailure: "Não foi possível gerar o relatório final. A VTR não foi excluída.",
      receiveFinalReport: async () => ({ blob: new Blob(["%PDF"]), receipt: "a".repeat(64) }),
      initiateFinalReportDownload: async () => { if (downloadError) throw new Error("bloqueado"); },
    },
  }, {
    window: { confirm: () => true },
    fetch: async (url, options) => { requests.push({ url, options }); return Response.json({}); },
  });
  const render = () => { cursor = 0; return FinalWithdrawal({ viatura: { id: vtrId, placa: "KKK5K55", tipo: "Viatura", situacao: "ativa" }, hasFinal: true }); };
  const elements = (tree) => {
    const output = [];
    const visit = (el) => {
      if (Array.isArray(el)) el.forEach(visit);
      else if (el?.props) { output.push(el); visit(el.props.children); }
    };
    visit(tree);
    return output;
  };
  const click = async (label) => {
    const element = elements(render()).find((el) => el.type === "button" && el.props.children === label);
    assert.ok(element, label);
    if (!element.props.disabled) { element.props.onClick(); await new Promise((resolve) => setImmediate(resolve)); }
  };
  await click("CONFIRMAR EXCLUSÃO DEFINITIVA");
  assert.equal(requests.length, 0);
  await click("GERAR PDF COMPLETO");
  await click("CONFIRMAR EXCLUSÃO DEFINITIVA");
  assert.equal(requests.length, 1);
  downloadError = true;
  await click("BAIXAR / SALVAR PDF COMPLETO");
  assert.equal(elements(render()).some((el) => el.type === "input" && el.props.type === "checkbox"), false);
  assert.equal(requests.length, 1);
  downloadError = false;
  await click("BAIXAR / SALVAR PDF COMPLETO");
  elements(render()).find((el) => el.type === "input" && el.props.type === "checkbox").props.onChange({ target: { checked: true } });
  await click("CONFIRMAR EXCLUSÃO DEFINITIVA");
  assert.equal(requests.at(-1).options.method, "DELETE");
  assert.equal(JSON.parse(requests.at(-1).options.body).pdfSalvo, true);
});

async function database(withFinalMigration = true) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${userId}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, perfil text, ativo boolean);
    INSERT INTO public.profiles VALUES ('${userId}','administrador',true);
    CREATE TABLE public.viaturas(id uuid PRIMARY KEY, placa text, tipo text, quilometragem integer, situacao text);
    CREATE TABLE public.registros_vtr(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), viatura_id uuid CONSTRAINT registros_vtr_viatura_id_fkey REFERENCES public.viaturas(id) ON DELETE CASCADE,
      tipo_registro text CONSTRAINT registros_vtr_tipo_registro_check CHECK(tipo_registro IN ('checkin_inicial','baixa','recebimento')),
      km integer, combustivel text, oleo_motor text, liquido_arrefecimento text, checklist jsonb, usuario_id uuid,
      criado_em timestamptz DEFAULT now());
    CREATE TABLE public.fotos_registro_vtr(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), registro_id uuid CONSTRAINT fotos_registro_vtr_registro_id_fkey REFERENCES public.registros_vtr(id) ON DELETE CASCADE,
      caminho_storage text, descricao text, criado_em timestamptz DEFAULT now());
    CREATE TABLE storage.objects(bucket_id text, name text);
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role, authenticated;
    GRANT USAGE ON SCHEMA auth, storage TO service_role, authenticated;
    GRANT ALL ON storage.objects TO service_role;
    INSERT INTO public.viaturas VALUES
      ('${vtrId}','KKK5K55','Viatura',50,'ativa'), ('${otherId}','ABC1D23','Viatura',50,'baixada');
  `);
  await db.exec(readFileSync("supabase/migrations/202610080002_vtr_permanent_deletion.sql", "utf8"));
  if (withFinalMigration) await db.exec(readFileSync("supabase/migrations/202610100001_inspections_and_final_report.sql", "utf8"));
  await db.exec("SELECT set_config('request.jwt.claim.role','service_role',false); SET ROLE service_role;");
  return db;
}

test("Migration: categorias antigas nullable, únicas obrigatórias, avarias múltiplas; final ADMIN e recibo obrigatório", async () => {
  const db = await database();
  try {
    await assert.rejects(db.query("SELECT public.preparar_exclusao_vtr($1)", [vtrId]), (e) => e.code === "42501");
    await assert.rejects(db.query("SELECT public.iniciar_vistoria_final($1,$2,$3)", [vtrId, otherId, answers]), (e) => e.code === "42501");
    const { rows: [{ id }] } = await db.query("SELECT public.iniciar_vistoria_final($1,$2,$3) AS id", [vtrId, userId, answers]);
    await assert.rejects(db.query("SELECT public.concluir_fotos_vistoria($1,$2)", [vtrId, id]), (e) => e.code === "23514");
    for (const category of inspection.inspectionCategories) {
      await db.query("INSERT INTO public.fotos_registro_vtr(registro_id,caminho_storage,categoria) VALUES ($1,$2,$3)",
        [id, `${vtrId}/${id}/${category.value}.jpg`, category.value]);
    }
    await assert.rejects(db.query("INSERT INTO public.fotos_registro_vtr(registro_id,categoria) VALUES ($1,'frente')", [id]), (e) => e.code === "23505");
    await db.query("INSERT INTO public.fotos_registro_vtr(registro_id,categoria,caminho_storage) VALUES ($1,'avarias',$2)", [id, `${vtrId}/${id}/avarias2.jpg`]);
    await assert.rejects(db.query("UPDATE public.viaturas SET situacao = 'baixada' WHERE id = $1", [vtrId]), (e) => e.code === "55000");
    await assert.rejects(db.query("SELECT public.selar_vistoria_final($1)", [vtrId]), /FINAL_INSPECTION_REQUIRED/);
    await db.query("SELECT public.concluir_fotos_vistoria($1,$2)", [vtrId, id]);
    await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES ('fotos-vtr',$1)", [`${vtrId}/${id}/upload-nao-registrado.jpg`]);
    await assert.rejects(db.query("SELECT public.selar_vistoria_final($1)", [vtrId]), /UNTRACKED_UPLOAD_IN_PROGRESS/);
    await db.query("DELETE FROM storage.objects WHERE name = $1", [`${vtrId}/${id}/upload-nao-registrado.jpg`]);
    await db.query("SELECT public.selar_vistoria_final($1)", [vtrId]);
    await assert.rejects(db.query("DELETE FROM public.registros_vtr WHERE id = $1", [id]), (e) => e.code === "55000");
    await assert.rejects(db.query("SELECT public.autorizar_exclusao_relatorio($1,$2,$3)", [vtrId, userId, "a".repeat(64)]), (e) => e.code === "42501");
    await db.query("UPDATE public.retiradas_vtr SET recibo_hash = $2, pdf_hash = $2, pdf_bytes = 100 WHERE viatura_id = $1", [vtrId, "a".repeat(64)]);
    await assert.rejects(db.query("SELECT public.autorizar_exclusao_relatorio($1,$2,$3)", [vtrId, userId, "b".repeat(64)]), (e) => e.code === "42501");
    await db.query("SELECT public.autorizar_exclusao_relatorio($1,$2,$3)", [vtrId, userId, "a".repeat(64)]);
    await db.query("SELECT public.preparar_exclusao_vtr($1)", [vtrId]);
    await db.query("SELECT public.concluir_exclusao_vtr($1)", [vtrId]);
    for (const table of ["registros_vtr", "fotos_registro_vtr", "retiradas_vtr", "exclusoes_vtr"]) {
      assert.equal((await db.query(`SELECT * FROM public.${table}`)).rows.length, 0);
    }
    assert.deepEqual((await db.query("SELECT id FROM public.viaturas")).rows, [{ id: otherId }]);
  } finally { await db.close(); }
});

const cascadeOrders = [
  ["registros_vtr", "retiradas_vtr", "exclusoes_vtr"],
  ["registros_vtr", "exclusoes_vtr", "retiradas_vtr"],
  ["retiradas_vtr", "registros_vtr", "exclusoes_vtr"],
  ["retiradas_vtr", "exclusoes_vtr", "registros_vtr"],
  ["exclusoes_vtr", "registros_vtr", "retiradas_vtr"],
  ["exclusoes_vtr", "retiradas_vtr", "registros_vtr"],
];

for (const order of cascadeOrders) {
  test(`Snapshot e cascade: ordem de criação das FKs ${order.join(" -> ")}, três retiradas completas`, async () => {
    const db = await database();
    try {
      await db.exec("RESET ROLE;");
      for (const table of order) {
        await db.exec(`ALTER TABLE public.${table} DROP CONSTRAINT ${table}_viatura_id_fkey;`);
      }
      for (const table of order) {
        await db.exec(`ALTER TABLE public.${table} ADD CONSTRAINT ${table}_viatura_id_fkey
          FOREIGN KEY (viatura_id) REFERENCES public.viaturas(id) ON DELETE CASCADE;`);
      }
      await db.exec("SET ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',false);");
      const { rows: [{ id: untouchedRecord }] } = await db.query(
        "INSERT INTO public.registros_vtr(viatura_id,tipo_registro) VALUES ($1,'checkin_inicial') RETURNING id", [otherId],
      );
      await db.query("INSERT INTO public.fotos_registro_vtr(registro_id,caminho_storage) VALUES ($1,$2)",
        [untouchedRecord, `${otherId}/${untouchedRecord}/preservada.jpg`]);
      for (let iteration = 0; iteration < 3; iteration++) {
        if (iteration > 0) {
          await db.query("INSERT INTO public.viaturas(id,placa,tipo,quilometragem,situacao) VALUES ($1,'KKK5K55','Viatura',50,'ativa')", [vtrId]);
        }
        const { rows: [{ id: historyId }] } = await db.query(
          "INSERT INTO public.registros_vtr(viatura_id,tipo_registro) VALUES ($1,'checkin_inicial') RETURNING id", [vtrId],
        );
        await db.query("INSERT INTO public.fotos_registro_vtr(registro_id,caminho_storage) VALUES ($1,$2)",
          [historyId, `${vtrId}/${historyId}/entrada.jpg`]);
        const { rows: [{ id: finalId }] } = await db.query(
          "SELECT public.iniciar_vistoria_final($1,$2,$3) AS id", [vtrId, userId, answers],
        );
        for (const category of inspection.inspectionCategories.filter((c) => c.value !== "avarias")) {
          await db.query("INSERT INTO public.fotos_registro_vtr(registro_id,categoria,caminho_storage) VALUES ($1,$2,$3)",
            [finalId, category.value, `${vtrId}/${finalId}/${category.value}.jpg`]);
        }
        const assertLocked = async () => {
          for (const registroId of [historyId, finalId]) {
            await assert.rejects(db.query("DELETE FROM public.registros_vtr WHERE id = $1", [registroId]), /REPORT_SNAPSHOT_LOCKED/);
            await assert.rejects(db.query("DELETE FROM public.fotos_registro_vtr WHERE registro_id = $1", [registroId]), /REPORT_SNAPSHOT_LOCKED/);
          }
          assert.equal((await db.query("SELECT count(*)::integer AS n FROM public.registros_vtr WHERE viatura_id = $1", [vtrId])).rows[0].n, 2);
          assert.equal((await db.query(`SELECT count(*)::integer AS n FROM public.fotos_registro_vtr f
            JOIN public.registros_vtr r ON r.id=f.registro_id WHERE r.viatura_id=$1`, [vtrId])).rows[0].n, 7);
        };
        await db.query("SELECT public.concluir_fotos_vistoria($1,$2)", [vtrId, finalId]);
        await assertLocked(); // pronta, antes de gerar PDF
        await assert.rejects(db.query("SELECT public.preparar_exclusao_vtr($1)", [vtrId]), /REPORT_RECEIPT_REQUIRED/);
        await db.query("SELECT public.selar_vistoria_final($1)", [vtrId]);
        await assertLocked(); // selada, sem recibo confirmado
        await assert.rejects(db.query("SELECT public.preparar_exclusao_vtr($1)", [vtrId]), /REPORT_RECEIPT_REQUIRED/);
        await db.query("UPDATE public.retiradas_vtr SET recibo_hash=$2,pdf_hash=$2,pdf_bytes=100 WHERE viatura_id=$1", [vtrId, "a".repeat(64)]);
        await db.query("SELECT public.autorizar_exclusao_relatorio($1,$2,$3)", [vtrId, userId, "a".repeat(64)]);
        await assertLocked(); // autorizada, mas exclusão ainda não preparada
        await assert.rejects(db.query("DELETE FROM public.viaturas WHERE id=$1", [vtrId]), /USE_ADMIN_DELETION_FLOW/);
        await db.query("SELECT public.preparar_exclusao_vtr($1)", [vtrId]);
        await db.exec("RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.role','authenticated',false);");
        await assertLocked(); // cliente comum não recebe a exceção mesmo com a fila preparada
        await assert.rejects(db.query("SELECT public.concluir_exclusao_vtr($1)", [vtrId]), (error) => error.code === "42501");
        await db.exec("RESET ROLE; SET ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',false);");
        // Exercita a exceção com pai e controles ainda visíveis, sem depender de cascades.
        await db.exec("BEGIN;");
        await db.query("DELETE FROM public.fotos_registro_vtr WHERE registro_id=$1", [historyId]);
        await db.query("DELETE FROM public.registros_vtr WHERE id=$1", [historyId]);
        await db.exec("ROLLBACK;");
        // A RPC executa DELETE da viatura e todos os cascades reais do PostgreSQL.
        await db.query("SELECT public.concluir_exclusao_vtr($1)", [vtrId]);
        for (const table of ["viaturas", "registros_vtr", "fotos_registro_vtr", "retiradas_vtr", "exclusoes_vtr"]) {
          const expected = ["retiradas_vtr", "exclusoes_vtr"].includes(table) ? 0 : 1;
          assert.equal((await db.query(`SELECT count(*)::integer AS n FROM public.${table}`)).rows[0].n, expected, table);
        }
        assert.deepEqual((await db.query("SELECT id FROM public.viaturas")).rows, [{ id: otherId }]);
      }
    } finally { await db.close(); }
  });
}

test("Migration preserva fotos antigas sem categoria e bloqueia final por cliente authenticated", async () => {
  const db = await database();
  try {
    const { rows: [{ id }] } = await db.query("INSERT INTO public.registros_vtr(viatura_id,tipo_registro) VALUES ($1,'checkin_inicial') RETURNING id", [otherId]);
    for (const suffix of ["foto1.jpg", "foto2.jpg"]) {
      await db.query("INSERT INTO public.fotos_registro_vtr(registro_id,caminho_storage) VALUES ($1,$2)", [id, `${otherId}/${id}/${suffix}`]);
    }
    assert.equal((await db.query("SELECT * FROM public.fotos_registro_vtr WHERE categoria IS NULL")).rows.length, 2);
    await db.exec("RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.role','authenticated',false);");
    await assert.rejects(db.query("INSERT INTO public.registros_vtr(viatura_id,tipo_registro,usuario_id) VALUES ($1,'vistoria_final',$2)", [vtrId, userId]), (error) => error.code === "42501");
    await assert.rejects(db.query("SELECT public.iniciar_vistoria_final($1,$2,$3)", [vtrId, userId, answers]), (error) => error.code === "42501");
    assert.equal((await db.query("SELECT * FROM public.viaturas")).rows.length, 2);
  } finally { await db.close(); }
});

test("Upload anterior em andamento: metadado é rejeitado, rollback limpa arquivo e selagem espera limpeza", async () => {
  const db = await database();
  try {
    const { rows: [{ id: oldRecord }] } = await db.query("INSERT INTO public.registros_vtr(viatura_id,tipo_registro) VALUES ($1,'baixa') RETURNING id", [vtrId]);
    const { rows: [{ id: finalRecord }] } = await db.query("SELECT public.iniciar_vistoria_final($1,$2,$3) AS id", [vtrId, userId, answers]);
    for (const category of inspection.inspectionCategories.filter((category) => category.value !== "avarias")) {
      await db.query("INSERT INTO public.fotos_registro_vtr(registro_id,categoria,caminho_storage) VALUES ($1,$2,$3)",
        [finalRecord, category.value, `${vtrId}/${finalRecord}/${category.value}.jpg`]);
    }
    const latePath = `${vtrId}/${oldRecord}/foto-tardia.jpg`;
    // Simula a Storage API exclusivamente na base isolada de testes.
    await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES ('fotos-vtr',$1)", [latePath]);
    await assert.rejects(db.query("INSERT INTO public.fotos_registro_vtr(registro_id,caminho_storage) VALUES ($1,$2)", [oldRecord, latePath]),
      (error) => error.code === "55000");
    await assert.rejects(db.query("SELECT public.selar_vistoria_final($1)", [vtrId]), /FINAL_INSPECTION_REQUIRED/);
    await db.query("DELETE FROM storage.objects WHERE name = $1", [latePath]);
    await db.query("DELETE FROM public.registros_vtr WHERE id = $1", [oldRecord]);
    await db.query("SELECT public.concluir_fotos_vistoria($1,$2)", [vtrId, finalRecord]);
    await db.query("SELECT public.selar_vistoria_final($1)", [vtrId]);
    assert.equal((await db.query("SELECT * FROM storage.objects")).rows.length, 0);
    assert.equal((await db.query("SELECT fase FROM public.retiradas_vtr")).rows[0].fase, "selada");
  } finally { await db.close(); }
});

test("Migration transacional: falha intermediária reverte campos, funções, policies e triggers", async () => {
  const db = await database(false);
  try {
    await db.exec("RESET ROLE;");
    const snapshot = async () => (await db.query(`
      SELECT 'constraint' AS kind, conname AS name, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace = 'public'::regnamespace
      UNION ALL SELECT 'function', proname, pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
      UNION ALL SELECT 'trigger', tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal
      UNION ALL SELECT 'policy', policyname, concat(qual,with_check) FROM pg_policies WHERE schemaname = 'public'
      ORDER BY kind,name
    `)).rows;
    const before = await snapshot();
    const migration = readFileSync("supabase/migrations/202610100001_inspections_and_final_report.sql", "utf8");
    await assert.rejects(db.exec(migration.replace("COMMIT;", "SELECT 1/0; COMMIT;")), /division by zero/);
    await db.exec("ROLLBACK;");
    assert.deepEqual(await snapshot(), before);
    assert.equal((await db.query("SELECT to_regclass('public.retiradas_vtr') AS table")).rows[0].table, null);
    assert.equal((await db.query("SELECT * FROM information_schema.columns WHERE table_name='fotos_registro_vtr' AND column_name='categoria'")).rows.length, 0);
  } finally { await db.close(); }
});

test("PDF completo inclui todos os eventos/fotos e rejeita foto corrupta em vez de omitir", async () => {
  const { generateFullHistoryPdf, fullHistoryFileName } = load("lib/full-history-pdf.ts");
  const events = ["checkin_inicial", "baixa", "recebimento", "vistoria_final"].map((tipoRegistro, index) => ({
    registro: {
      tipoRegistro, criadoEm: `2026-10-0${index + 1}T12:00:00Z`, km: 100 + index,
      combustivel: "cheio", oleoMotor: "bom", liquidoArrefecimento: "bom", checklist: { pintura: "Boa", lataria: "Boa" },
      responsavel: "ADMIN Teste", reparosRealizados: true, descricaoReparos: "Reparo",
      empresa: "Oficina", responsavelEntrega: "Responsável", cpfResponsavelEntrega: "12345678901",
    },
    profile: { rg_id: "12345", base: "Delta", ala: "Alfa" },
    fotos: [{ bytes: image, categoria: "frente", descricao: "Frente da VTR" }],
  }));
  const pdf = await generateFullHistoryPdf({ placa: "KKK5K55", tipo: "Viatura" }, events);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.equal((pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length, 9);
  assert.ok((pdf.toString("latin1").match(/\/Subtype \/Image/g) ?? []).length >= 4);
  assert.equal(fullHistoryFileName("KKK5K55"), "HISTORICO_COMPLETO_KKK5K55.pdf");
  await assert.rejects(generateFullHistoryPdf({ placa: "KKK5K55", tipo: "Viatura" }, events.map((event) => ({
    ...event, fotos: [{ bytes: Buffer.from("corrupta"), categoria: "frente", descricao: null }],
  }))));
});

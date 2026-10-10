import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import ts from "typescript";

const root = resolve(".cloudflare/output/v0/workers/default/bundle");
const config = JSON.parse(readFileSync(resolve(root, "../worker.config.json"), "utf8"));
const supabaseUrl = config.env.NEXT_PUBLIC_SUPABASE_URL.value;
const image = readFileSync("public/carro.png");
const viatura = { id: "vtr", placa: "ABC1D23", tipo: "Viatura" };
const registro = {
  id: "registro",
  viatura_id: viatura.id,
  tipo_registro: "baixa",
  km: 1000,
  criado_em: "2026-10-06T12:00:00Z",
  checklist: null,
};
const expires = Math.floor(Date.now() / 1000) + 3600;
const user = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "fixture@example.test",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: expires })}.fixture`;
const cookie = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token=base64-${encode({
  access_token: token,
  refresh_token: "fixture",
  expires_at: expires,
  expires_in: 3600,
  token_type: "bearer",
  user,
})}`;
let mf;
let photoCount = 0;
let downloads = [];
let generateRegistroPdf;
let receiveFinalReport;
let finalReportMode = false;
let photoFailure = false;
let adminActive = true;
let writes = [];
const finalChecklist = {
  km_atual: 1000, pintura: "Boa", lataria: "Boa", combustivel: "Cheio",
  oleo_motor: "Bom", liquido_arrefecimento: "Bom",
  seta_dianteira_direita: "OK", seta_dianteira_esquerda: "OK", seta_traseira_direita: "OK", seta_traseira_esquerda: "OK",
  luz_freio: "OK", luz_alerta: "OK", farol_alto: "OK", farol_baixo: "OK", buzina: "OK",
  pneu_dianteiro_esquerdo: "OK", pneu_dianteiro_direito: "OK", pneu_traseiro_esquerdo: "OK", pneu_traseiro_direito: "OK",
  strobo: "OK", sirene: "OK", giroflex: "OK", retrovisor_direito: "Possui", retrovisor_esquerdo: "Possui",
  estepe: "Possui", triangulo: "Possui", chave_roda: "Possui",
};
const lifeEvents = ["checkin_inicial", "baixa", "recebimento", "vistoria_final"].map((tipo_registro, index) => ({
  ...registro, id: `evento-${index}`, tipo_registro, usuario_id: user.id,
  criado_em: `2026-10-0${index + 1}T12:00:00Z`, checklist: finalChecklist,
}));
const categories = ["frente", "lateral_direita", "lateral_esquerda", "traseira", "painel", "equipamentos"];
const lifePhotos = lifeEvents.flatMap((event, index) => (
  index === 0 || index === 3 ? [...categories, "avarias", "avarias"] : ["avarias"]
).map((categoria, n) => ({
  registro_id: event.id, caminho_storage: `vtr/${event.id}/${n}.png`, descricao: null, categoria,
})));

before(async () => {
  const source = readFileSync("lib/registro-pdf.ts", "utf8").replace(
    "@/lib/plate",
    pathToFileURL(resolve("lib/plate.ts")).href,
  ).replace(
    '"pdfkit"',
    JSON.stringify(pathToFileURL(createRequire(import.meta.url).resolve("pdfkit")).href),
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  ({ generateRegistroPdf } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`));
  const downloadModule = ts.transpileModule(readFileSync("lib/final-report-download.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  ({ receiveFinalReport } = await import(`data:text/javascript;base64,${Buffer.from(downloadModule.outputText).toString("base64")}`));

  const paths = readdirSync(root, { recursive: true }).filter((path) => path.endsWith(".js"));
  const modules = ["index.js", ...paths.filter((path) => path !== "index.js")].map((path) => ({
    type: "ESModule",
    path: resolve(root, path),
    contents: readFileSync(resolve(root, path), "utf8"),
  }));
  mf = new Miniflare(convertV4MiniflareOptions({
    modules,
    modulesRoot: root,
    compatibilityDate: config.compatibilityDate,
    compatibilityFlags: config.compatibilityFlags,
    bindings: {
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture",
      SUPABASE_SECRET_KEY: "fixture",
    },
    kvNamespaces: ["VINEXT_KV_CACHE"],
    images: { binding: "IMAGES" },
    serviceBindings: { ASSETS: () => new Response(null, { status: 404 }) },
    outboundService: async (request) => {
      const url = new URL(request.url);
      assert.equal(url.origin, new URL(supabaseUrl).origin);
      if (finalReportMode) {
        const counted = (rows) => Response.json(rows, { headers: { "Content-Range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` } });
        if (request.method !== "GET") writes.push({ method: request.method, path: url.pathname });
        switch (url.pathname) {
          case "/auth/v1/user": return Response.json(user);
          case "/rest/v1/profiles": return url.searchParams.get("select")?.includes("nome_completo")
            ? counted([{ id: user.id, nome_completo: "ADMIN Fixture", rg_id: "123", base: "Delta", ala: "Alfa" }])
            : Response.json({ perfil: "administrador", ativo: adminActive });
          case "/rest/v1/retiradas_vtr": return Response.json(request.method === "PATCH"
            ? { viatura_id: "vtr" } : { registro_id: lifeEvents.at(-1).id, fase: "selada" });
          case "/rest/v1/rpc/selar_vistoria_final": return new Response(null, { status: 204 });
          case "/rest/v1/viaturas": return Response.json(viatura);
          case "/rest/v1/registros_vtr": return counted(lifeEvents);
          case "/rest/v1/fotos_registro_vtr": return counted(lifePhotos);
          default:
            assert.match(url.pathname, /^\/storage\/v1\/object\/fotos-vtr\/vtr\/evento-\d\/\d+\.png$/);
            downloads.push(url.href);
            if (photoFailure) return Response.json({ message: "Foto indisponível" }, { status: 404 });
            return new Response(image, { headers: { "Content-Type": "image/png" } });
        }
      }
      assert.equal(request.method, "GET");
      switch (url.pathname) {
        case "/auth/v1/user": return Response.json(user);
        case "/rest/v1/profiles": return Response.json({ perfil: "operador", ativo: true });
        case "/rest/v1/viaturas": return Response.json(viatura);
        case "/rest/v1/registros_vtr": return Response.json(registro);
        case "/rest/v1/fotos_registro_vtr":
          return Response.json(Array.from({ length: photoCount }, (_, index) => ({
            caminho_storage: `vtr/registro/${index}.png`,
            descricao: `Foto ${index + 1}`,
          })));
        default:
          assert.match(url.pathname, /^\/storage\/v1\/object\/fotos-vtr\/vtr\/registro\/\d+\.png$/);
          assert.ok(request.headers.get("authorization")?.startsWith("Bearer "));
          downloads.push(url.href);
          return new Response(image, { headers: { "Content-Type": "image/png" } });
      }
    },
  }));
});

after(async () => {
  if (mf) await mf.dispose();
});

const agents = {
  desktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  celular: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148",
};

for (const count of [0, 1, 3]) {
  for (const [device, agent] of Object.entries(agents)) {
    test(`PDF com ${count} foto(s), ${device}, no Worker Vinext`, async () => {
      photoCount = count;
      downloads = [];
      const response = await mf.dispatchFetch(
        "https://worker.test/api/viaturas/vtr/registros/registro/pdf",
        { headers: { cookie, "user-agent": agent } },
      );
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/pdf");
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.match(response.headers.get("content-disposition"), /^inline; filename="VTR_.*\.pdf"$/);
      assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      assert.match(bytes.toString("latin1"), /%%EOF\s*$/);
      assert.equal(downloads.length, count);

      const desktopPdf = await generateRegistroPdf(viatura, {
        tipoRegistro: registro.tipo_registro,
        criadoEm: registro.criado_em,
        km: registro.km,
        checklist: null,
      }, Array.from({ length: count }, (_, index) => ({
        bytes: image,
        descricao: `Foto ${index + 1}`,
      })));
      for (const pattern of [/\/Subtype \/Image\b/g, /\/Type \/Page\b/g, /\/MediaBox \[[^\]]+\]/g, /\/BaseFont \/[\w-]+/g]) {
        assert.deepEqual(bytes.toString("latin1").match(pattern), desktopPdf.toString("latin1").match(pattern));
      }
      if (count > 0) assert.match(bytes.toString("latin1"), /\/Subtype \/Image\b/);
    });
  }
}

test("PDF continua exigindo sessao autenticada", async () => {
  const response = await mf.dispatchFetch("https://worker.test/api/viaturas/vtr/registros/registro/pdf");
  assert.equal(response.status, 401);
});

for (const [device, agent] of Object.entries({
  ...agents,
  android: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36",
})) {
  test(`PDF completo: quatro eventos e 18 fotos no workerd, ${device}, sem excluir`, async () => {
    finalReportMode = true; photoFailure = false; adminActive = true; downloads = []; writes = [];
    const response = await mf.dispatchFetch("https://worker.test/api/viaturas/vtr/relatorio-final", {
      headers: { cookie, "user-agent": agent },
    });
    assert.equal(response.status, 200, response.status !== 200 ? await response.text() : "");
    const received = await receiveFinalReport(response);
    const bytes = Buffer.from(await received.blob.arrayBuffer());
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(Number(response.headers.get("x-relatorio-bytes")), bytes.length);
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    assert.match(bytes.toString("latin1"), /%%EOF\s*$/);
    assert.match(response.headers.get("x-relatorio-recibo"), /^[a-f0-9]{64}$/);
    assert.match(response.headers.get("x-relatorio-sha256"), /^[a-f0-9]{64}$/);
    assert.match(response.headers.get("content-disposition"), /HISTORICO_COMPLETO_ABC1D23\.pdf/);
    assert.equal(downloads.length, lifePhotos.length);
    assert.ok((bytes.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length >= 23);
    assert.deepEqual(writes, [
      { method: "POST", path: "/rest/v1/rpc/selar_vistoria_final" },
      { method: "PATCH", path: "/rest/v1/retiradas_vtr" },
    ]);
  });
}

test("PDF completo no Worker: foto indisponível não emite recibo nem chama exclusão", async () => {
  finalReportMode = true; photoFailure = true; downloads = []; writes = [];
  const response = await mf.dispatchFetch("https://worker.test/api/viaturas/vtr/relatorio-final", { headers: { cookie } });
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("x-relatorio-recibo"), null);
  assert.equal((await response.json()).message, "Não foi possível gerar o relatório final. A VTR não foi excluída.");
  assert.deepEqual(writes, [{ method: "POST", path: "/rest/v1/rpc/selar_vistoria_final" }]);
});

test("PDF completo no Worker exige ADMIN ativo", async () => {
  finalReportMode = true; adminActive = false; writes = [];
  const response = await mf.dispatchFetch("https://worker.test/api/viaturas/vtr/relatorio-final", { headers: { cookie } });
  assert.equal(response.status, 403);
  assert.equal(writes.length, 0);
});

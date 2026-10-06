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
    },
    kvNamespaces: ["VINEXT_KV_CACHE"],
    images: { binding: "IMAGES" },
    serviceBindings: { ASSETS: () => new Response(null, { status: 404 }) },
    outboundService: async (request) => {
      const url = new URL(request.url);
      assert.equal(url.origin, new URL(supabaseUrl).origin);
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

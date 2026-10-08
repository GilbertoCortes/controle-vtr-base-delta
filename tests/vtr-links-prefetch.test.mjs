import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import { canLinkIntentPrefetch, canLinkPrefetch } from "../node_modules/vinext/dist/shims/link-prefetch.js";
import ts from "typescript";

const require = createRequire(import.meta.url);

test("Cartões de VTR desabilitam prefetch e preservam destino; link de cadastro permanece inalterado", async () => {
  const viaturas = [
    { id: "vtr-1", placa: "ABC1D23", tipo: "Viatura", situacao: "ativa" },
    { id: "vtr-2", placa: "DEF4G56", tipo: "Motocicleta", situacao: "baixada" },
  ];
  const dependencies = {
    "@/lib/supabase/admin": {
      getAdminSession: async () => ({
        user: { id: "fixture" },
        supabase: {
          from: (table) => {
            assert.equal(table, "viaturas");
            return { select: () => ({ order: async () => ({ data: viaturas, error: null }) }) };
          },
        },
      }),
    },
    "@/lib/plate": { formatPlate: (plate) => plate },
    "next/link": { default: "fixture-link", __esModule: true },
    "next/image": { default: "fixture-image", __esModule: true },
  };
  const { outputText } = ts.transpileModule(readFileSync("app/protected/page.tsx", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const loaded = { exports: {} };
  vm.runInNewContext(outputText, {
    module: loaded, exports: loaded.exports,
    require: (name) => dependencies[name] ?? require(name),
  });
  const page = loaded.exports.default();
  const content = await page.props.children.type();
  const links = [];
  function visit(element) {
    if (Array.isArray(element)) {
      element.forEach(visit);
    } else if (element && typeof element === "object" && element.props) {
      if (element.type === "fixture-link") links.push(element.props);
      visit(element.props.children);
    }
  }
  visit(content);
  for (const viatura of viaturas) {
    const link = links.find((item) => item.href === `/protected/viaturas/${viatura.id}`);
    assert.ok(link);
    assert.equal(link.prefetch, false);
    assert.equal(link["aria-label"], `Abrir VTR ${viatura.placa}`);
    assert.equal(link.onClick, undefined);
    assert.equal(link.replace, undefined);
  }
  assert.equal(links.length, viaturas.length + 1);
  assert.equal(links.find((link) => link.href === "/protected/viaturas/nova").prefetch, undefined);
});

test("Runtime Cloudflare/Vinext: prefetch=false bloqueia viewport e hover no App Router em produção", () => {
  const input = { nodeEnv: "production", isDangerous: false, routerMode: "app" };
  assert.equal(canLinkPrefetch(input), true);
  assert.equal(canLinkIntentPrefetch(input), true);
  assert.equal(canLinkPrefetch({ ...input, prefetch: false }), false);
  assert.equal(canLinkIntentPrefetch({ ...input, prefetch: false }), false);
});

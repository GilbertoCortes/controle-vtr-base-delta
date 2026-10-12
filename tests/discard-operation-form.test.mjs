import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);

function mount(file, exportName) {
  const state = [];
  const refs = [];
  let stateIndex = 0;
  let refIndex = 0;
  let setups = [];
  const listeners = new Map();
  const removedDrafts = [];
  const drafts = new Map();
  const dependencies = {
    react: {
      useState(initial) {
        const index = stateIndex++;
        if (!(index in state)) state[index] = initial;
        return [state[index], (value) => { state[index] = value; }];
      },
      useRef(initial) {
        const index = refIndex++;
        return refs[index] ??= { current: initial };
      },
      useEffect(callback) { setups.push(callback); },
    },
    "next/navigation": { useRouter: () => ({}) },
    "@/lib/plate": { formatPlate: (value) => value },
    "@/lib/draft-storage": {
      getDraftUserId: async () => "user",
      removeDraft: (user, scope) => { removedDrafts.push([user, scope]); drafts.delete(`${user}:${scope}`); },
      loadDraft: (user, scope) => drafts.get(`${user}:${scope}`) ?? null,
      saveDraft: (user, scope, value) => { drafts.set(`${user}:${scope}`, value); return true; },
    },
  };
  for (const path of ["lib/vtr-draft", "lib/vtr-inspection", "lib/plate"]) {
    const local = { exports: {} };
    const result = ts.transpileModule(readFileSync(`${path}.ts`, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    vm.runInNewContext(result.outputText, { module: local, exports: local.exports });
    dependencies[`@/${path}`] = local.exports;
  }
  const loaded = { exports: {} };
  const { outputText } = ts.transpileModule(readFileSync(`components/${file}.tsx`, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  vm.runInNewContext(outputText, {
    module: loaded, exports: loaded.exports,
    require: (name) => dependencies[name] ?? require(name),
    window: {
      addEventListener: (event, callback) => listeners.set(event, callback),
      removeEventListener: (event) => listeners.delete(event),
    },
    fetch: () => assert.fail("Navegar sem finalizar não deve enviar dados"),
  });
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    setups = [];
    return loaded.exports[exportName]({
      viatura: { id: "vtr", placa: "ABC1D23", tipo: "Viatura", situacao: "ativa" },
      finalViatura: file === "initial-checkin-form" ? { id: "vtr", placa: "ABC1D23", tipo: "Viatura", situacao: "ativa" } : undefined,
      motivoBaixa: "Manutenção",
    });
  };
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (!node?.props) return [];
    return [node, ...nodes(node.props.children)];
  }
  const field = (id) => nodes(render()).find((node) => node.props.id === id);
  render();
  return { render, field, setup: () => {
    const cleanups = setups.map((setup) => setup());
    return () => cleanups.forEach((cleanup) => cleanup?.());
  }, state, listeners, removedDrafts, drafts };
}

for (const [file, exportName, kmId] of [
  ["baixa-vtr-form", "BaixaVtrForm", "km-baixa"],
  ["recebimento-oficina-form", "RecebimentoOficinaForm", "km-recebimento"],
  ["initial-checkin-form", "InitialCheckinForm", "km_atual"],
]) {
  if (file !== "initial-checkin-form") {
    test(`${file}: restaura rascunho anterior sem removê-lo`, async () => {
      const form = mount(file, exportName);
      const scope = file === "baixa-vtr-form" ? "baixa:vtr" : "recebimento-oficina:vtr";
      form.drafts.set(`user:${scope}`, {
        answers: { km_atual: "321" },
        motivoObservacoes: "manutenção",
        empresa: "Oficina anterior",
        cpfDigits: "12345678901",
        photos: [{ id: "antiga", nome: "foto.jpg", dataUrl: "data:image/jpeg;base64,YQ==" }],
      });
      form.setup();
      await Promise.resolve();
      assert.equal(form.field(kmId).props.value, "321");
      assert.equal(form.removedDrafts.length, 0);
      assert.equal(form.state.find(Array.isArray)?.length, 1);
      if (file === "recebimento-oficina-form") {
        assert.equal(form.field("empresa").props.value, "Oficina anterior");
      }
    });
  }

  test(`${file}: KM aceita somente dígitos ao digitar ou colar`, async () => {
    const form = mount(file, exportName);
    form.setup();
    await Promise.resolve();
    assert.equal(form.field(kmId).props.type, "text");
    assert.equal(form.field(kmId).props.inputMode, "numeric");
    for (const valid of ["0", "123", "00123", ""]) {
      form.field(kmId).props.onChange({ target: { value: valid } });
      assert.equal(form.field(kmId).props.value, valid);
      for (const invalid of ["e", "1e3", "1E3", "-5", "+5", "1.5", "1,5", "12a", " 12", "１２"]) {
        form.field(kmId).props.onChange({ target: { value: invalid } });
        assert.equal(form.field(kmId).props.value, valid);
      }
    }
  });

  test(`${file}: ${file === "initial-checkin-form" ? "descarta" : "preserva"} campos e fotos ao sair e retornar`, async () => {
    const form = mount(file, exportName);
    const cleanup = form.setup();
    await Promise.resolve();
    assert.equal(form.removedDrafts.length, 0);
    assert.equal(form.render().props.autoComplete, "off");
    assert.equal(form.field(kmId).props.value, "");
    form.field(kmId).props.onChange({ target: { value: "123" } });
    assert.equal(form.field(kmId).props.value, "123");
    // Representa fotos já preparadas em memória, que também devem ser descartadas.
    const photosIndex = form.state.findIndex(Array.isArray);
    form.state[photosIndex] = [{ id: "photo", nome: "foto", dataUrl: "data:image/jpeg;base64,YQ==" }];
    if (file !== "initial-checkin-form") {
      const scope = file === "baixa-vtr-form" ? "baixa:vtr" : "recebimento-oficina:vtr";
      form.drafts.set(`user:${scope}`, { ...form.drafts.get(`user:${scope}`), photos: form.state[photosIndex] });
    }
    if (file === "recebimento-oficina-form") {
      form.field("empresa").props.onChange({ target: { value: "Oficina" } });
      form.field("cpf-entrega").props.onChange({ target: { value: "12345678901" } });
    }
    cleanup();
    assert.equal(form.listeners.size, 0);
    form.setup();
    await Promise.resolve();
    assert.equal(form.field(kmId).props.value, file === "initial-checkin-form" ? "" : "123");
    assert.equal(form.state[photosIndex].length, file === "initial-checkin-form" ? 0 : 1);
    if (file === "recebimento-oficina-form") {
      assert.equal(form.field("empresa").props.value, "Oficina");
      assert.equal(form.field("cpf-entrega").props.value, "123.456.789-01");
    }
  });

  test(`${file}: navegação externa ${file === "initial-checkin-form" ? "descarta" : "preserva"} o KM`, async () => {
    const form = mount(file, exportName);
    form.setup();
    await Promise.resolve();
    form.field(kmId).props.onChange({ target: { value: "123" } });
    form.listeners.get("pagehide")?.();
    assert.equal(form.field(kmId).props.value, file === "initial-checkin-form" ? "" : "123");
    form.field(kmId).props.onChange({ target: { value: "456" } });
    form.listeners.get("pageshow")?.({ persisted: true });
    assert.equal(form.field(kmId).props.value, file === "initial-checkin-form" ? "" : "456");
  });
}

test("Placa aceita apenas a sequência Mercosul, progressivamente e em maiúsculas", () => {
  const form = mount("new-viatura-form", "NewViaturaForm");
  for (const prefix of ["a", "ab", "abc", "abc1", "abc1d", "abc1d2", "abc1d23"]) {
    form.field("placa").props.onChange({ target: { value: prefix } });
    assert.equal(form.field("placa").props.value, prefix.toUpperCase());
  }
  for (const invalid of ["1", "A1", "AB1", "ABCD", "ABC12", "ABC1DD", "ABC1D2D", "ABC1D234", "ABC-1D23"]) {
    form.field("placa").props.onChange({ target: { value: invalid } });
    assert.equal(form.field("placa").props.value, "ABC1D23");
  }
  form.field("placa").props.onChange({ target: { value: "ABC1D2" } });
  assert.equal(form.field("placa").props.value, "ABC1D2");
  form.field("placa").props.onChange({ target: { value: "" } });
  assert.equal(form.field("placa").props.value, "");
});

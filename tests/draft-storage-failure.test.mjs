import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

function compile(source) {
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}

test('Quota cheia remove somente o rascunho antigo da operação e permite nova gravação', () => {
  const entries = new Map();
  let full = false;
  const sessionStorage = {
    setItem(k, v) { if (full) throw new Error('QuotaExceededError'); entries.set(k, v); },
    getItem(k) { return entries.get(k) ?? null; },
    removeItem(k) { entries.delete(k); },
  };
  const loaded = { exports: {} };
  vm.runInNewContext(compile(readFileSync('lib/draft-storage.ts', 'utf8')), {
    module: loaded, exports: loaded.exports, sessionStorage, require: () => ({}),
  });
  const { saveDraft, loadDraft } = loaded.exports;
  assert.equal(saveDraft('a', 'baixa', { km: 1 }), true);
  assert.equal(saveDraft('b', 'baixa', { km: 2 }), true);
  full = true;
  assert.equal(saveDraft('a', 'baixa', { km: 3, photos: ['foto'] }), false);
  assert.equal(loadDraft('a', 'baixa'), null);
  assert.equal(loadDraft('b', 'baixa').km, 2);
  full = false;
  assert.equal(saveDraft('a', 'baixa', { km: 3 }), true);
  assert.equal(loadDraft('a', 'baixa').km, 3);
});

for (const file of ['initial-checkin-form', 'baixa-vtr-form', 'recebimento-oficina-form']) {
  for (const storageWorks of [false, true]) {
    test(`${file}: envia respostas e fotos quando persistência retorna ${storageWorks}`, async () => {
      const source = readFileSync(`components/${file}.tsx`, 'utf8');
      const ast = ts.createSourceFile('form.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      let handler;
      function visit(node) {
        if (ts.isFunctionDeclaration(node) && node.name?.text === 'handleSubmit') handler = node.getText(ast);
        ts.forEachChild(node, visit);
      }
      visit(ast);
      assert.ok(handler);
      const requests = [];
      const errors = [];
      const photos = [{ dataUrl: 'data:image/jpeg;base64,YQ==' }];
      const context = {
        viatura: { id: 'fixture' }, isSubmitting: false, submitting: false, completed: false,
        answers: { km_atual: '123' }, photos, observacoes: 'observação', motivoObservacoes: 'manutenção',
        cpfDigits: '12345678901', reparosRealizados: 'Sim', descricaoReparos: 'freios',
        empresa: 'oficina', responsavelEntrega: 'teste',
        persist: () => storageWorks, persistCheckin: () => storageWorks,
        setSubmitting() {}, setIsSubmitting() {}, setCompleted() {},
        setSaveError: value => errors.push(value), setSubmitError: value => errors.push(value),
        fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); throw new Error('offline'); },
      };
      vm.createContext(context);
      vm.runInContext(compile(`${handler}\nglobalThis.submit = handleSubmit;`), context);
      await context.submit({ preventDefault() {} });
      assert.equal(requests.length, 1);
      const payload = requests[0].body.checkin ?? requests[0].body;
      assert.equal(payload.answers.km_atual, '123');
      assert.equal(payload.photos[0].dataUrl, photos[0].dataUrl);
      assert.ok(errors.some(value => typeof value === 'string' && value.includes('Mantenha esta página aberta')));
    });
  }
}

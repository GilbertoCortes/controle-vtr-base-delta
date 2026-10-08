<a href="https://demo-nextjs-with-supabase.vercel.app/">
  <img alt="Next.js and Supabase Starter Kit - the fastest way to build apps with Next.js and Supabase" src="https://demo-nextjs-with-supabase.vercel.app/opengraph-image.png">
  <h1 align="center">Next.js and Supabase Starter Kit</h1>
</a>

<p align="center">
 The fastest way to build apps with Next.js and Supabase
</p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#demo"><strong>Demo</strong></a> ·
  <a href="#deploy-to-vercel"><strong>Deploy to Vercel</strong></a> ·
  <a href="#clone-and-run-locally"><strong>Clone and run locally</strong></a> ·
  <a href="#feedback-and-issues"><strong>Feedback and issues</strong></a>
  <a href="#more-supabase-examples"><strong>More Examples</strong></a>
</p>
<br/>

## Features

- Works across the entire [Next.js](https://nextjs.org) stack
  - App Router
  - Pages Router
  - Proxy
  - Client
  - Server
  - It just works!
- supabase-ssr. A package to configure Supabase Auth to use cookies
- Password-based authentication block installed via the [Supabase UI Library](https://supabase.com/ui/docs/nextjs/password-based-auth)
- Styling with [Tailwind CSS](https://tailwindcss.com)
- Components with [shadcn/ui](https://ui.shadcn.com/)
- Optional deployment with [Supabase Vercel Integration and Vercel deploy](#deploy-your-own)
  - Environment variables automatically assigned to Vercel project

## Demo

You can view a fully working demo at [demo-nextjs-with-supabase.vercel.app](https://demo-nextjs-with-supabase.vercel.app/).

## Deploy to Vercel

Vercel deployment will guide you through creating a Supabase account and project.

After installation of the Supabase integration, all relevant environment variables will be assigned to the project so the deployment is fully functioning.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvercel%2Fnext.js%2Ftree%2Fcanary%2Fexamples%2Fwith-supabase&project-name=nextjs-with-supabase&repository-name=nextjs-with-supabase&demo-title=nextjs-with-supabase&demo-description=This+starter+configures+Supabase+Auth+to+use+cookies%2C+making+the+user%27s+session+available+throughout+the+entire+Next.js+app+-+Client+Components%2C+Server+Components%2C+Route+Handlers%2C+Server+Actions+and+Middleware.&demo-url=https%3A%2F%2Fdemo-nextjs-with-supabase.vercel.app%2F&external-id=https%3A%2F%2Fgithub.com%2Fvercel%2Fnext.js%2Ftree%2Fcanary%2Fexamples%2Fwith-supabase&demo-image=https%3A%2F%2Fdemo-nextjs-with-supabase.vercel.app%2Fopengraph-image.png)

The above will also clone the Starter kit to your GitHub, you can clone that locally and develop locally.

If you wish to just develop locally and not deploy to Vercel, [follow the steps below](#clone-and-run-locally).

## Clone and run locally

1. You'll first need a Supabase project which can be made [via the Supabase dashboard](https://database.new)

2. Create a Next.js app using the Supabase Starter template npx command

   ```bash
   npx create-next-app --example with-supabase with-supabase-app
   ```

   ```bash
   yarn create next-app --example with-supabase with-supabase-app
   ```

   ```bash
   pnpm create next-app --example with-supabase with-supabase-app
   ```

3. Use `cd` to change into the app's directory

   ```bash
   cd with-supabase-app
   ```

4. Rename `.env.example` to `.env.local` and update the following:

  ```env
  NEXT_PUBLIC_SUPABASE_URL=[INSERT SUPABASE PROJECT URL]
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=[INSERT SUPABASE PROJECT API PUBLISHABLE OR ANON KEY]
  ```
  > [!NOTE]
  > This example uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, which refers to Supabase's new **publishable** key format.
  > Both legacy **anon** keys and new **publishable** keys can be used with this variable name during the transition period. Supabase's dashboard may show `NEXT_PUBLIC_SUPABASE_ANON_KEY`; its value can be used in this example.
  > See the [full announcement](https://github.com/orgs/supabase/discussions/29260) for more information.

  Both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` can be found in [your Supabase project's API settings](https://supabase.com/dashboard/project/_?showConnect=true)

5. You can now run the Next.js local development server:

   ```bash
   npm run dev
   ```

   The starter kit should now be running on [localhost:3000](http://localhost:3000/).

6. This template comes with the default shadcn/ui style initialized. If you instead want other ui.shadcn styles, delete `components.json` and [re-install shadcn/ui](https://ui.shadcn.com/docs/installation/next)

> Check out [the docs for Local Development](https://supabase.com/docs/guides/getting-started/local-development) to also run Supabase locally.

## Feedback and issues

### Cadastro de usuários: edição somente administrativa

`/protected/meu-perfil` é somente para consulta, inclusive para administradores.
Alterações cadastrais são realizadas em **Gerenciar Usuários**. As APIs de
criação, edição e ativação/desativação verificam sessão de administrador ativo
antes de usar a chave administrativa, disponível somente no servidor.
O antigo `PATCH /api/meu-perfil` rejeita alterações com HTTP 403 para sessões
ativas; sessões inválidas ou desativadas mantêm a rejeição existente.

A política informada do banco, `usuario_atualiza_proprio_perfil`, permitia
UPDATE quando `id = auth.uid()`. A migration
[`202610080001_profiles_admin_only_writes.sql`](supabase/migrations/202610080001_profiles_admin_only_writes.sql)
remove essa política e a política de UPDATE direto de administradores,
revoga permissões de gravação da tabela e das colunas para clientes públicos
e autenticados, bloqueia UPDATE via RLS e restringe as versões existentes de
`guard_admin_update` a `service_role`. Todas as colunas são protegidas, inclusive
colunas cadastrais adicionadas futuramente. As políticas de SELECT
`usuario_visualiza_proprio_perfil` e `administrador_visualiza_perfis` não são
alteradas. Nenhum registro é modificado pela migration.

Aplicar a migration no SQL Editor do Supabase após revisão. **Gerar o arquivo
não aplica a proteção no banco**: publique o código e aplique o SQL para concluir
o bloqueio, inclusive de requisições diretas ao Supabase. A chave
`SUPABASE_SECRET_KEY` deve continuar configurada somente no servidor.

Validação local de interface, autorização e fluxos administrativos com dados
simulados, além da execução da migration em PostgreSQL isolado em memória
via PGlite, dependência usada somente nos testes (sem modificar produção):

```bash
node --test tests/profiles-permissions.test.mjs
```

Após aplicar a migration, valide com uma sessão real de usuário comum:
leitura do próprio perfil deve funcionar e `PATCH /rest/v1/profiles?id=eq.<id>`
deve falhar com permissão negada. Com administrador ativo, valide edição,
criação e ativação/desativação pelas APIs administrativas do app.

### PDF no Cloudflare/Vinext

O PDFKit resolve o perfil de cores interno com `new URL(..., import.meta.url)`.
Como `workerd` não fornece `import.meta.url`, o plugin
`pdfkit-worker` em `vite.config.ts` substitui essa base por uma URL
`file:` absoluta durante o build e inclui as mesmas fontes padrão por imports
estáticos, evitando `createRequire` no Worker. Mantém a versão Node do PDFKit
e seus streams. A correção se limita ao PDFKit;
não altera o layout, o download autenticado das fotos no Supabase ou o build
Next.js.

Validação local com o runtime real `workerd` e respostas simuladas do Supabase
(sem acessar produção):

```bash
npm run build:vinext
node --test tests/registro-pdf-worker.test.mjs
```

Os testes cobrem PDFs com zero, uma e três fotos, agentes desktop/celular,
URLs absolutas de download, autenticação e equivalência de fontes, páginas e
imagens com o gerador Node.

### Retirada definitiva de VTRs

O botão de retirar VTR mantém o acesso exclusivo de ADMIN e pede confirmação:
“Esta ação excluirá permanentemente esta VTR, todo o seu histórico e todas as
fotos vinculadas. Esta ação não poderá ser desfeita.”
`DELETE /api/viaturas/<id>` exige administrador ativo e o corpo
`{"confirmacao":"EXCLUIR DEFINITIVAMENTE"}`. Não há tela de VTRs removidas,
arquivamento lógico ou restauração.

O servidor prepara a operação, remove fisicamente os arquivos pela **API do
Supabase Storage** e só então exclui a VTR. As foreign keys
`registros_vtr_viatura_id_fkey` e `fotos_registro_vtr_registro_id_fkey`, ambas
`ON DELETE CASCADE`, removem histórico e metadados na mesma transação.
A limpeza inclui os caminhos dos metadados e todos os objetos sob
`fotos-vtr/<id-vtr>/`, inclusive uploads sem registro de foto. Caminhos
inconsistentes com o ID da VTR abortam a operação, sem apagar fotos de outra VTR.
Outros buckets e outras VTRs não são afetados.

Banco e Storage não oferecem uma transação única. `exclusoes_vtr` guarda
**somente uma operação técnica pendente e seus caminhos**, sem histórico
arquivado nem possibilidade de restauração. Se houver falha, o servidor retorna
erro explícito, conserva a operação para retomada e impede novos históricos,
metadados de fotos ou alterações naquela VTR pelas tabelas `public`.
Não há triggers ou alterações estruturais no schema gerenciado `storage`:
`storage.objects` é consultada somente com SELECT; arquivos são gravados e
removidos exclusivamente pela Storage API. Retirar a mesma VTR novamente retoma
a limpeza. O cadastro pode permanecer visível até a conclusão, mas não pode
receber novas gravações. O sucesso só é retornado após verificar que não há
objetos restantes no Storage e excluir o cadastro e seus dependentes;
a operação técnica também é apagada. Não exclua manualmente essa fila nem
apague apenas linhas de `storage.objects`: isso não elimina arquivos físicos.

Um upload de baixa/recebimento já em andamento pode terminar após o início
da exclusão. O trigger em `public.fotos_registro_vtr` rejeita seu metadado
(ou a VTR já não existe), acionando o rollback do fluxo. Esse rollback usa
o cliente administrativo **somente no servidor**, remove pela Storage API todos
os caminhos tentados por aquela requisição e depois apaga somente seu registro;
não depende das permissões DELETE do usuário. Os caminhos são registrados antes
do upload, incluindo o caso de resposta perdida após persistir o arquivo.
Uma falha de cleanup é registrada e informada explicitamente: indisponibilidade
da Storage API ou encerramento do processo impede garantir limpeza imediata,
e exige retomada/suporte. Não há bloqueio de uploads diretos ao bucket por estes
triggers; permissões de upload do Storage continuam sendo as já configuradas.

A policy restritiva `viaturas_delete_somente_admin_ativo` continua negando
DELETE direto a usuários comuns, inclusive para uma VTR sem históricos.
Ela impediria o rollback de cadastro feito com a sessão desse usuário;
por isso o rollback de cadastro também usa o cliente administrativo no servidor,
limitado ao ID retornado pelo INSERT e aos arquivos/registro da própria requisição.
Não existe endpoint que permita ao usuário escolher uma VTR para esse rollback.
As permissões de cadastro normal não são ampliadas.

#### Implantação e VTRs já arquivadas

**Nenhuma migration ou limpeza remota é executada automaticamente.**
Faça backup e programe uma janela de manutenção sem sessões/gravações em curso.
As VTRs já arquivadas serão excluídas definitivamente, conforme a decisão
administrativa, antes de remover seus campos de arquivamento:

1. Aplicar somente
   [`202610080002_vtr_permanent_deletion.sql`](supabase/migrations/202610080002_vtr_permanent_deletion.sql).
   Ela confere as FKs e recusa dependências adicionais não revisadas; instala
   a fila técnica, RPCs exclusivas de `service_role`, triggers somente nas tabelas
   `public` contra gravações concorrentes e proteção contra DELETE que deixaria
   fotos no Storage. Possui `BEGIN`/`COMMIT` e permite reaplicação, preservando
   operações pendentes; a policy é recriada com `DROP POLICY IF EXISTS`.
   Publicar também a correção de rollback junto da migration.
2. Em ambiente administrativo confiável, com Node.js 22.18+ e a chave
   `SUPABASE_SECRET_KEY` configurada em `.env.local`, consultar as VTRs legadas:

   ```bash
   node scripts/delete-legacy-vtrs.mjs
   ```

   Esse comando **apenas lista** as VTRs com `arquivada = true`.
   Depois de revisar, confirmar explicitamente a limpeza:

   ```bash
   node scripts/delete-legacy-vtrs.mjs --confirmar-exclusao-definitiva
   ```

   Isso exclui somente essas VTRs, todos os seus registros e fotos, usando a
   mesma rotina da API. Se falhar, pare a implantação, resolva o erro e execute
   novamente: a limpeza pendente é retomada. VTRs não arquivadas são preservadas.
   A chave administrativa nunca deve ir ao navegador.
3. Aplicar
   [`202610080003_remove_vtr_archive_columns.sql`](supabase/migrations/202610080003_remove_vtr_archive_columns.sql).
   Ela **recusa execução** enquanto houver VTR arquivada ou exclusão pendente;
   remove `viaturas.arquivada`, `arquivada_em`, `arquivada_por` e a FK dessa
   última coluna, sem `CASCADE` em dependências desconhecidas.
4. Publicar o novo código antes de reabrir o app. O código antigo depende dos
   campos removidos; não mantenha instâncias antigas gravando durante a mudança.
   Preservar e aplicar também a migration de perfis, se ainda estiver pendente.
5. Validar com contas reais: usuário comum recebe 403 na exclusão; ADMIN
   consegue excluir VTR ativa ou baixada; nenhuma linha/arquivo da VTR permanece
   e outra VTR mantém cadastro, histórico, fotos e geração de PDF.

Validação local sem acessar produção:

```bash
node --test tests/vtr-deletion.test.mjs tests/profiles-permissions.test.mjs
npm run build
npm run build:vinext
node --test tests/registro-pdf-worker.test.mjs
npx next typegen && npx tsc --noEmit
```

Please file feedback and issues over on the [Supabase GitHub org](https://github.com/supabase/supabase/issues/new/choose).

## More Supabase examples

- [Next.js Subscription Payments Starter](https://github.com/vercel/nextjs-subscription-payments)
- [Cookie-based Auth and the Next.js 13 App Router (free course)](https://youtube.com/playlist?list=PL5S4mPUpp4OtMhpnp93EFSo42iQ40XjbF)
- [Supabase Auth and the Next.js App Router](https://github.com/supabase/supabase/tree/master/examples/auth/nextjs)

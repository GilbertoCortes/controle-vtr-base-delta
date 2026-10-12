import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/supabase/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin-server";

type PerfilPayload = {
  nome_completo?: unknown;
  rg_id?: unknown;
  email?: unknown;
  base?: unknown;
  ala?: unknown;
  perfil?: unknown;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireActiveSession();
  if (!session.ok) return session.response;
  if (!session.isAdmin) return NextResponse.json({ message: "Ação permitida somente para administradores." }, { status: 403 });

  let payload: PerfilPayload;
  try {
    payload = (await request.json()) as PerfilPayload;
  } catch {
    return NextResponse.json({ message: "Dados do usuário inválidos." }, { status: 400 });
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ message: "Dados do usuário inválidos." }, { status: 400 });
  }

  const nomeCompleto = typeof payload.nome_completo === "string" ? payload.nome_completo.trim() : "";
  const rgId = typeof payload.rg_id === "string" ? payload.rg_id.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const base = typeof payload.base === "string" ? payload.base.trim() : "";
  const ala = typeof payload.ala === "string" ? payload.ala.trim() : "";
  const perfil = payload.perfil;

  if (!nomeCompleto || !rgId || !email || !base || !ala) {
    return NextResponse.json({ message: "Preencha todos os campos obrigatórios." }, { status: 400 });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ message: "Informe um e-mail válido." }, { status: 400 });
  }
  if (perfil !== "usuario" && perfil !== "administrador") {
    return NextResponse.json({ message: "Selecione um perfil válido." }, { status: 400 });
  }

  const { id } = await params;
  const actorId = session.user.id;
  const adminClient = createSupabaseAdminClient();
  const { data: currentProfile, error: currentProfileError } = await adminClient
    .from("profiles")
    .select("id, nome_completo, rg_id, email, base, ala, perfil, ativo, edicao_id, auth_sync_pending")
    .eq("id", id)
    .maybeSingle();
  if (currentProfileError) {
    return NextResponse.json({ message: "Não foi possível carregar o perfil do usuário." }, { status: 500 });
  }
  if (!currentProfile) return NextResponse.json({ message: "Usuário não encontrado." }, { status: 404 });

  if (currentProfile.auth_sync_pending) {
    return NextResponse.json({ message: "Há uma sincronização de e-mail pendente. Procure o suporte antes de editar novamente." }, { status: 409 });
  }
  const fields = ["nome_completo", "rg_id", "email", "base", "ala", "perfil", "edicao_id"] as const;
  const snapshot = (value: Record<string, unknown>) => Object.fromEntries(fields.map((key) => [key, value[key] ?? null]));
  const original = snapshot(currentProfile);
  const dados = { nome_completo: nomeCompleto, rg_id: rgId, email, base, ala, perfil };
  const { data: authUser, error: authLookupError } = await adminClient.auth.admin.getUserById(id);
  if (authLookupError || !authUser.user?.email) {
    return NextResponse.json({ message: "Não foi possível carregar a conta Auth deste usuário." }, { status: 500 });
  }
  const oldAuthEmail = authUser.user.email;

  // O token permite confirmar uma gravação cuja resposta se perdeu, e a
  // comparação evita que uma compensação sobrescreva outra edição.
  async function edit(expected: Record<string, unknown>, values: Record<string, unknown>, compensacao = false) {
    const operationId = randomUUID();
    const { data, error } = await Promise.resolve(adminClient.rpc("editar_perfil_usuario", {
      target_id: id, actor_id: actorId, operation_id: operationId, expected, dados: values,
      auth_sync: !compensacao && email !== oldAuthEmail, compensacao,
    })).catch(() => ({ data: null, error: { code: "NETWORK", message: "Falha de comunicação." } }));
    if (!error && data) return { saved: snapshot(data), error: null };
    const { data: actual, error: lookupError } = await adminClient.from("profiles")
      .select("nome_completo, rg_id, email, base, ala, perfil, edicao_id").eq("id", id).maybeSingle();
    if (!lookupError && actual?.edicao_id === operationId) return { saved: snapshot(actual), error: null };
    return { saved: null, error };
  }

  const committed = await edit(original, dados);
  if (!committed.saved) {
    const code = committed.error?.code;
    if (code === "P0001") return NextResponse.json({ message: "Não é possível remover ou desativar o último administrador ativo." }, { status: 409 });
    if (code === "40001") return NextResponse.json({ message: "Os dados foram alterados por outra operação. Atualize a página antes de editar novamente." }, { status: 409 });
    if (code === "P0002") return NextResponse.json({ message: "Usuário não encontrado." }, { status: 404 });
    if (code === "23505" || code === "23514") return NextResponse.json({ message: "Dados inválidos ou já utilizados por outro usuário." }, { status: 400 });
    return NextResponse.json({ message: "Não foi possível confirmar a edição. Confira os dados antes de tentar novamente." }, { status: 503 });
  }

  if (email !== oldAuthEmail) {
    const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(id, { email, email_confirm: true })
      .catch(() => ({ error: { status: 0, message: "Falha de comunicação." } }));
    if (authUpdateError) {
      const { data: actualAuth, error: lookupError } = await adminClient.auth.admin.getUserById(id)
        .catch(() => ({ data: { user: null }, error: { message: "Falha de comunicação." } }));
      if (lookupError || actualAuth.user?.email !== email) {
        // Somente uma rejeição definitiva do Auth permite compensação.
        // Uma resposta de rede perdida ainda pode concluir depois desta leitura.
        if (!lookupError && actualAuth.user?.email === oldAuthEmail
            && typeof authUpdateError.status === "number" && authUpdateError.status >= 400 && authUpdateError.status < 500) {
          const restored = await edit(committed.saved, original, true);
          if (restored.saved) {
            return NextResponse.json({ message: "Não foi possível atualizar o e-mail. A edição foi desfeita; os dados anteriores foram preservados." }, { status: 400 });
          }
        }
        // Auth e PostgreSQL são serviços separados: não inventar um rollback
        // confirmado quando a comunicação ou uma edição concorrente o impede.
        console.error("Edição de usuário precisa de reconciliação", { id, operationId: committed.saved.edicao_id });
        return NextResponse.json({ message: "Os dados cadastrais foram salvos, mas não foi possível confirmar a sincronização do e-mail de acesso. Procure o suporte antes de editar novamente." }, { status: 503 });
      }
    }
    const { data: finished, error: finishError } = await Promise.resolve(adminClient.rpc("concluir_edicao_perfil", {
      target_id: id, operation_id: committed.saved.edicao_id,
    })).catch(() => ({ data: null, error: { message: "Falha de comunicação." } }));
    if (finishError || finished !== true) {
      const { data: actual, error: lookupError } = await adminClient.from("profiles")
        .select("edicao_id, auth_sync_pending").eq("id", id).maybeSingle();
      if (lookupError || actual?.edicao_id !== committed.saved.edicao_id || actual.auth_sync_pending) {
        return NextResponse.json({ message: "A edição foi salva, mas sua conclusão não pôde ser confirmada. Procure o suporte antes de editar novamente." }, { status: 503 });
      }
    }
  }
  return NextResponse.json({ message: "Dados do usuário atualizados com sucesso." });
}

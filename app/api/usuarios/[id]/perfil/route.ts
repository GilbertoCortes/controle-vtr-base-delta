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
  const adminClient = createSupabaseAdminClient();
  const { data: currentProfile, error: currentProfileError } = await adminClient
    .from("profiles")
    .select("id, email, perfil, ativo")
    .eq("id", id)
    .maybeSingle();
  if (currentProfileError) {
    return NextResponse.json({ message: "Não foi possível carregar o perfil do usuário." }, { status: 500 });
  }
  if (!currentProfile) return NextResponse.json({ message: "Usuário não encontrado." }, { status: 404 });

  let oldAuthEmail: string | undefined;
  if (email !== currentProfile.email) {
    const { data: authUser, error: authLookupError } = await adminClient.auth.admin.getUserById(id);
    if (authLookupError || !authUser.user) {
      return NextResponse.json({ message: "Não foi possível carregar a conta Auth deste usuário." }, { status: 500 });
    }
    oldAuthEmail = authUser.user.email;

    const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(id, {
      email,
      email_confirm: true,
    });
    if (authUpdateError) {
      return NextResponse.json({ message: "Não foi possível atualizar o e-mail da conta." }, { status: 400 });
    }
  }

  const { error: profileUpdateError } = await adminClient
    .from("profiles")
    .update({ nome_completo: nomeCompleto, rg_id: rgId, email, base, ala })
    .eq("id", id);

  if (profileUpdateError) {
    if (oldAuthEmail) {
      const { error: rollbackError } = await adminClient.auth.admin.updateUserById(id, {
        email: oldAuthEmail,
        email_confirm: true,
      });
      if (rollbackError) {
        console.error("Falha ao restaurar e-mail Auth após falha ao atualizar perfil", {
          message: rollbackError.message,
          code: rollbackError.code,
        });
      }
    }
    console.error("Falha ao atualizar public.profiles", {
      message: profileUpdateError.message,
      code: profileUpdateError.code,
    });
    return NextResponse.json({ message: "Não foi possível salvar os dados do usuário." }, { status: 500 });
  }

  const { error: guardError } = await adminClient.rpc("guard_admin_update", {
    target_id: id,
    new_ativo: currentProfile.ativo,
    new_perfil: perfil,
  });
  if (guardError) {
    if (guardError.code === "P0002") {
      return NextResponse.json({ message: "Usuário não encontrado." }, { status: 404 });
    }
    if (guardError.code === "P0001") {
      return NextResponse.json(
        { message: "Não é possível remover ou desativar o último administrador ativo." },
        { status: 409 },
      );
    }
    if (guardError.code === "P0003") {
      return NextResponse.json({ message: "Selecione um perfil válido." }, { status: 400 });
    }
    console.error("Falha na proteção de administrador", { message: guardError.message, code: guardError.code });
    return NextResponse.json({ message: "Não foi possível salvar os dados do usuário." }, { status: 500 });
  }

  return NextResponse.json({ message: "Dados do usuário atualizados com sucesso." });
}
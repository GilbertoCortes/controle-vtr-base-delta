import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/supabase/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin-server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireActiveSession();
  if (!session.ok) return session.response;
  if (!session.isAdmin) {
    return NextResponse.json({ message: "Ação permitida somente para administradores ativos." }, { status: 403 });
  }

  let body: { ativo?: unknown };
  try {
    body = (await request.json()) as { ativo?: unknown };
  } catch {
    return NextResponse.json({ message: "Solicitação inválida." }, { status: 400 });
  }
  if (typeof body.ativo !== "boolean") {
    return NextResponse.json({ message: "Estado de acesso inválido." }, { status: 400 });
  }

  const { id: targetUserId } = await params;
  const adminClient = createSupabaseAdminClient();
  const { data: profile, error: lookupError } = await adminClient
    .from("profiles")
    .select("id, ativo, perfil")
    .eq("id", targetUserId)
    .maybeSingle();

  if (lookupError) {
    console.error("Falha ao consultar perfil para alterar acesso", {
      message: lookupError.message,
      code: lookupError.code,
    });
    return NextResponse.json({ message: "Não foi possível localizar o usuário." }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json({ message: "Usuário não encontrado." }, { status: 404 });
  }
  if (profile.ativo === body.ativo) {
    return NextResponse.json({
      message: body.ativo ? "Este usuário já está ativo." : "Este usuário já foi removido.",
      ativo: profile.ativo,
    });
  }

  const { error: guardError } = await adminClient.rpc("guard_admin_update", {
    target_id: targetUserId,
    new_ativo: body.ativo,
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
    console.error("Falha ao atualizar ativo em public.profiles", {
      message: guardError.message,
      code: guardError.code,
      targetUserId,
    });
    return NextResponse.json(
      { message: "Não foi possível atualizar o acesso do usuário. Tente novamente." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message: body.ativo
      ? "Usuário reativado com sucesso."
      : "Acesso do usuário removido.",
    ativo: body.ativo,
  });
}
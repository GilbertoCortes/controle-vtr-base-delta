import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/supabase/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin-server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireActiveSession();
  if (!session.ok) return session.response;
  if (!session.isAdmin) return NextResponse.json({ message: "Ação permitida somente para administradores." }, { status: 403 });

  let body: { password?: unknown };
  try {
    body = (await request.json()) as { password?: unknown };
  } catch {
    return NextResponse.json({ message: "Dados da senha inválidos." }, { status: 400 });
  }
  if (typeof body.password !== "string" || body.password.length < 8) {
    return NextResponse.json({ message: "A nova senha deve ter pelo menos 8 caracteres." }, { status: 400 });
  }

  const { id } = await params;
  const adminClient = createSupabaseAdminClient();
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (profileError || !profile) {
    return NextResponse.json({ message: "Usuário não encontrado." }, { status: 404 });
  }

  const { error } = await adminClient.auth.admin.updateUserById(id, { password: body.password });
  if (error) {
    console.error("Falha ao alterar senha de usuário", { message: error.message, code: error.code });
    return NextResponse.json({ message: "Não foi possível alterar a senha. Tente novamente." }, { status: 400 });
  }

  return NextResponse.json({ message: "Senha alterada com sucesso." });
}
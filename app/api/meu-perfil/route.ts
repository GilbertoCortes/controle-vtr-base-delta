import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/supabase/admin";

export async function PATCH() {
  const session = await requireActiveSession();
  if (!session.ok) return session.response;

  return NextResponse.json(
    { message: "Meu Perfil é somente para consulta. Alterações são permitidas somente a administradores em Gerenciar Usuários." },
    { status: 403 },
  );
}
import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/supabase/admin";

type PerfilPayload = {
  nome_completo?: unknown;
  rg_id?: unknown;
  base?: unknown;
  ala?: unknown;
};

export async function PATCH(request: Request) {
  const session = await requireActiveSession();
  if (!session.ok) return session.response;
  const { supabase, user } = session;

  let payload: PerfilPayload;
  try {
    payload = (await request.json()) as PerfilPayload;
  } catch {
    return NextResponse.json({ message: "Dados do perfil inválidos." }, { status: 400 });
  }

  const nomeCompleto = typeof payload.nome_completo === "string" ? payload.nome_completo.trim() : "";
  const rgId = typeof payload.rg_id === "string" ? payload.rg_id.trim() : "";
  const base = typeof payload.base === "string" ? payload.base.trim() : "";
  const ala = typeof payload.ala === "string" ? payload.ala.trim() : "";
  if (!nomeCompleto || !rgId || !base || !ala) {
    return NextResponse.json({ message: "Preencha todos os dados funcionais obrigatórios." }, { status: 400 });
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .update({
      nome_completo: nomeCompleto,
      rg_id: rgId,
      base,
      ala,
    })
    .eq("id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Falha ao salvar perfil funcional", { message: error.message, code: error.code });
    return NextResponse.json(
      { message: "Não foi possível salvar seus dados funcionais. Tente novamente." },
      { status: 500 },
    );
  }
  if (!profile) {
    return NextResponse.json({ message: "Seu registro em public.profiles não foi encontrado." }, { status: 404 });
  }

  return NextResponse.json({ message: "Perfil salvo com sucesso." });
}
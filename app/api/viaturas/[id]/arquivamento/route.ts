import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/supabase/admin";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireActiveSession();
  if (!session.ok) return session.response;
  const { supabase, user, isAdmin } = session;
  if (!isAdmin) {
    return NextResponse.json({ message: "Ação permitida somente para administradores." }, { status: 403 });
  }

  let body: { arquivada?: unknown };
  try {
    body = (await request.json()) as { arquivada?: unknown };
  } catch {
    return NextResponse.json({ message: "Solicitação inválida." }, { status: 400 });
  }
  if (typeof body.arquivada !== "boolean") {
    return NextResponse.json({ message: "Estado de arquivamento inválido." }, { status: 400 });
  }

  const { id } = await params;
  const { data: viatura, error: lookupError } = await supabase
    .from("viaturas")
    .select("id, arquivada")
    .eq("id", id)
    .maybeSingle();
  if (lookupError) {
    return NextResponse.json({ message: "Não foi possível localizar a VTR." }, { status: 500 });
  }
  if (!viatura) {
    return NextResponse.json({ message: "VTR não encontrada." }, { status: 404 });
  }

  if (body.arquivada && viatura.arquivada) {
    return NextResponse.json({ message: "Esta VTR já foi removida da Base Delta." }, { status: 409 });
  }
  if (!body.arquivada && !viatura.arquivada) {
    return NextResponse.json({ message: "Esta VTR já está na Base Delta." }, { status: 409 });
  }

  const updatedAt = new Date().toISOString();
  const updateData = body.arquivada
    ? {
        arquivada: true,
        arquivada_em: updatedAt,
        arquivada_por: user.id,
        atualizado_em: updatedAt,
      }
    : {
        arquivada: false,
        arquivada_em: null,
        arquivada_por: null,
        atualizado_em: updatedAt,
      };
  const { data: updated, error: updateError } = await supabase
    .from("viaturas")
    .update(updateData)
    .eq("id", viatura.id)
    .eq("arquivada", viatura.arquivada)
    .select("id, arquivada")
    .maybeSingle();
  if (updateError) {
    return NextResponse.json({ message: "Não foi possível atualizar a VTR. Tente novamente." }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json(
      { message: "A VTR foi alterada por outra sessão. Atualize a página e tente novamente." },
      { status: 409 },
    );
  }

  return NextResponse.json({
    message: updated.arquivada
      ? "VTR removida da Base Delta."
      : "VTR restaurada para a Base Delta.",
    arquivada: updated.arquivada,
  });
}
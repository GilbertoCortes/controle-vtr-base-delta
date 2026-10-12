import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireActiveSession } from "@/lib/supabase/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin-server";
import { cancelVtrWithdrawal } from "@/lib/cancel-vtr-withdrawal";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireActiveSession();
  if (!session.ok) return session.response;
  if (!session.isAdmin) return NextResponse.json({ message: "Ação permitida somente para administradores." }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ message: "Identificação da VTR inválida." }, { status: 400 });
  }
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ message: "Confirmação de cancelamento inválida." }, { status: 400 });
  }
  const { registroId, confirmacao } = body as Record<string, unknown>;
  if (confirmacao !== "CANCELAR RETIRADA" || typeof registroId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(registroId)) {
    return NextResponse.json({ message: "Confirme o cancelamento da vistoria indicada." }, { status: 400 });
  }
  try {
    await cancelVtrWithdrawal(createSupabaseAdminClient(), id, registroId);
  } catch (error) {
    console.error("Falha ao descartar retirada", { id, error });
    const reason = error && typeof error === "object" && "message" in error ? String(error.message) : "";
    if (reason.includes("WITHDRAWAL_ALREADY_AUTHORIZED")) {
      return NextResponse.json({ message: "A retirada já foi autorizada e não pode ser cancelada." }, { status: 409 });
    }
    if (reason.includes("WITHDRAWAL_CHANGED") || reason.includes("WITHDRAWAL_NOT_FOUND")) {
      return NextResponse.json({ message: "A retirada mudou desde que a página foi aberta. Atualize a página antes de agir." }, { status: 409 });
    }
    return NextResponse.json({ message: "Não foi possível concluir o cancelamento. Confira os dados pendentes antes de tentar novamente." }, { status: 500 });
  }
  revalidatePath(`/protected/viaturas/${id}`);
  return NextResponse.json({ message: "Retirada descartada." });
}

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/supabase/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin-server";
import { deleteViatura, ViaturaDeletionError } from "@/lib/delete-viatura";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireActiveSession();
  if (!session.ok) return session.response;
  if (!session.isAdmin) {
    return NextResponse.json({ message: "Ação permitida somente para administradores." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Confirmação de exclusão inválida." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !("confirmacao" in body) || body.confirmacao !== "EXCLUIR DEFINITIVAMENTE") {
    return NextResponse.json({ message: "Confirme a exclusão definitiva da VTR." }, { status: 400 });
  }

  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ message: "Identificação da VTR inválida." }, { status: 400 });
  }

  try {
    await deleteViatura(createSupabaseAdminClient(), id);
  } catch (error) {
    if (error instanceof ViaturaDeletionError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("Falha inesperada na exclusão definitiva de VTR", { id, error });
    return NextResponse.json(
      { message: "Não foi possível concluir a exclusão. Tente novamente para concluir a limpeza." },
      { status: 500 },
    );
  }

  revalidatePath("/protected");
  revalidatePath(`/protected/viaturas/${id}`);
  return NextResponse.json({ message: "VTR, histórico e fotos excluídos permanentemente." });
}

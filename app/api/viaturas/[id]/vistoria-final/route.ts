import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireActiveSession } from "@/lib/supabase/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin-server";
import { prepareInspectionPhotos } from "@/lib/inspection-photos-server";
import { validateInspectionAnswers } from "@/lib/vtr-inspection";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireActiveSession();
  if (!session.ok) return session.response;
  if (!session.isAdmin) return NextResponse.json({ message: "Ação permitida somente para administradores." }, { status: 403 });
  const { id } = await params;
  const client = createSupabaseAdminClient();
  const { data: viatura, error } = await client.from("viaturas").select("id, tipo").eq("id", id).maybeSingle();
  if (error || !viatura) return NextResponse.json({ message: "Não foi possível carregar a VTR." }, { status: error ? 500 : 404 });
  if (viatura.tipo !== "Viatura" && viatura.tipo !== "Motocicleta") {
    return NextResponse.json({ message: "Tipo de VTR inválido." }, { status: 400 });
  }
  let payload: { answers?: unknown; photos?: unknown; observacoes?: unknown };
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Vistoria inválida.");
    payload = value;
  } catch {
    return NextResponse.json({ message: "Dados da vistoria inválidos." }, { status: 400 });
  }
  const validation = validateInspectionAnswers(payload.answers, viatura.tipo);
  if (validation) return NextResponse.json({ message: validation }, { status: 400 });
  let photos;
  try {
    photos = prepareInspectionPhotos(payload.photos);
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Fotos inválidas." }, { status: 400 });
  }
  const checklist = {
    ...(payload.answers as Record<string, unknown>),
    observacoes: typeof payload.observacoes === "string" ? payload.observacoes.trim() : "",
  };
  const { data: registroId, error: beginError } = await client.rpc("iniciar_vistoria_final", {
    target_id: id, actor_id: session.user.id, dados: checklist,
  });
  if (beginError || typeof registroId !== "string") {
    console.error("Falha ao iniciar vistoria final", { id, error: beginError });
    return NextResponse.json({ message: "Não foi possível iniciar a vistoria. Verifique o KM ou uma retirada já em andamento." }, { status: 409 });
  }
  const attemptedPaths: string[] = [];
  try {
    for (const photo of photos) {
      const path = `${id}/${registroId}/${randomUUID()}.${photo.extension}`;
      attemptedPaths.push(path);
      const { error: uploadError } = await client.storage.from("fotos-vtr").upload(path, photo.bytes, { contentType: photo.contentType, upsert: false });
      if (uploadError) throw uploadError;
      const { error: photoError } = await client.from("fotos_registro_vtr").insert({
        registro_id: registroId, caminho_storage: path, categoria: photo.categoria,
      });
      if (photoError) throw photoError;
    }
  } catch (error) {
    console.error("Falha ao salvar fotos da vistoria final", { id, error });
    // Nao removemos o controle da retirada se a limpeza fisica falhar.
    try {
      if (attemptedPaths.length) {
        const { error: cleanupError } = await client.storage.from("fotos-vtr").remove(attemptedPaths);
        if (cleanupError) throw cleanupError;
      }
      const { error: rollbackError } = await client.rpc("cancelar_vistoria_incompleta", { target_id: id, final_id: registroId });
      if (rollbackError) throw rollbackError;
    } catch (cleanupError) {
      console.error("Limpeza da vistoria final incompleta", { id, cleanupError });
      return NextResponse.json({ message: "A vistoria falhou e a limpeza ficou incompleta. A VTR não foi excluída. Procure o suporte." }, { status: 500 });
    }
    return NextResponse.json({ message: "Não foi possível salvar a vistoria final. A VTR não foi excluída." }, { status: 500 });
  }
  const { error: completionError } = await client.rpc("concluir_fotos_vistoria", { target_id: id, final_id: registroId });
  if (completionError) {
    console.error("Fotos salvas, mas confirmação da vistoria final falhou", { id, completionError });
    return NextResponse.json({ message: "As fotos foram salvas, mas não foi possível confirmar a vistoria final. A VTR não foi excluída. Atualize a página; se o erro persistir, procure o suporte." }, { status: 500 });
  }
  revalidatePath(`/protected/viaturas/${id}`);
  return NextResponse.json({ message: "Vistoria final salva.", registroId }, { status: 201 });
}

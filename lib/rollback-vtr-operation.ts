import { createSupabaseAdminClient } from "@/lib/supabase/admin-server";

type VtrOperation = {
  viaturaId: string | number;
  registroId: string | number | null;
  attemptedPaths: string[];
  deleteCreatedViatura?: boolean;
  deleteCreatedRegistro?: boolean;
};

export async function rollbackVtrOperation({
  viaturaId,
  registroId,
  attemptedPaths,
  deleteCreatedViatura = false,
  deleteCreatedRegistro = true,
}: VtrOperation): Promise<boolean> {
  try {
    if (attemptedPaths.some((path) => registroId === null || !path.startsWith(`${viaturaId}/${registroId}/`))) {
      throw new Error("Caminho fora da operação de VTR durante rollback.");
    }
    if (!attemptedPaths.length && !deleteCreatedRegistro && !deleteCreatedViatura) return true;
    const client = createSupabaseAdminClient();
    // Inclui uploads cuja resposta falhou apos o arquivo ter sido persistido.
    for (let offset = 0; offset < attemptedPaths.length; offset += 100) {
      const { error } = await client.storage.from("fotos-vtr").remove(attemptedPaths.slice(offset, offset + 100));
      if (error) throw error;
    }
    // A FK em cascata remove apenas os metadados de fotos deste registro.
    if (deleteCreatedRegistro && registroId !== null) {
      const { error } = await client.from("registros_vtr")
        .delete().eq("id", registroId).eq("viatura_id", viaturaId);
      if (error) throw error;
    }
    if (deleteCreatedViatura) {
      const { error } = await client.from("viaturas").delete().eq("id", viaturaId);
      if (error) throw error;
    }
    return true;
  } catch (error) {
    console.error("Falha no rollback da operação de VTR", { viaturaId, registroId, attemptedPaths, error });
    return false;
  }
}

// Nunca autorizar limpeza apenas com base em um erro de rede.
export async function reconcileVtrOperation({ viaturaId, registroId, actorId, tipo }: {
  viaturaId: string | number; registroId: string; actorId: string;
  tipo: "baixa" | "recebimento";
}): Promise<"registrada" | "cancelada" | "desconhecida"> {
  try {
    const { data, error } = await createSupabaseAdminClient().rpc("reconciliar_operacao_vtr", {
      target_id: viaturaId, actor_id: actorId, novo_registro_id: registroId, tipo,
    });
    if (error) throw error;
    if (data === "registrada" || data === "cancelada") return data;
    throw new Error("Resposta inválida na reconciliação da VTR.");
  } catch (error) {
    console.error("Falha ao reconciliar operação de VTR", { viaturaId, registroId, error });
    return "desconhecida";
  }
}

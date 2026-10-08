import { createSupabaseAdminClient } from "@/lib/supabase/admin-server";

type VtrOperation = {
  viaturaId: string | number;
  registroId: string | number | null;
  attemptedPaths: string[];
  deleteCreatedViatura?: boolean;
};

export async function rollbackVtrOperation({
  viaturaId,
  registroId,
  attemptedPaths,
  deleteCreatedViatura = false,
}: VtrOperation): Promise<boolean> {
  try {
    if (attemptedPaths.some((path) => registroId === null || !path.startsWith(`${viaturaId}/${registroId}/`))) {
      throw new Error("Caminho fora da operação de VTR durante rollback.");
    }
    const client = createSupabaseAdminClient();
    // Inclui uploads cuja resposta falhou apos o arquivo ter sido persistido.
    for (let offset = 0; offset < attemptedPaths.length; offset += 100) {
      const { error } = await client.storage.from("fotos-vtr").remove(attemptedPaths.slice(offset, offset + 100));
      if (error) throw error;
    }
    // A FK em cascata remove apenas os metadados de fotos deste registro.
    if (registroId !== null) {
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

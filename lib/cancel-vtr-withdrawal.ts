import type { SupabaseClient } from "@supabase/supabase-js";

export async function cancelVtrWithdrawal(client: SupabaseClient, id: string, registroId: string) {
  const { data: paths, error: prepareError } = await client.rpc("preparar_cancelamento_retirada", {
    target_id: id, expected_registro_id: registroId,
  });
  if (prepareError) throw prepareError;
  if (!Array.isArray(paths) || !paths.every((path): path is string => typeof path === "string" && path.startsWith(`${id}/${registroId}/`))) {
    throw new Error("Caminhos da vistoria inválidos.");
  }
  for (let offset = 0; offset < paths.length; offset += 100) {
    const { error } = await client.storage.from("fotos-vtr").remove(paths.slice(offset, offset + 100));
    if (error) throw error;
  }
  const { error: finishError } = await client.rpc("concluir_cancelamento_retirada", {
    target_id: id, expected_registro_id: registroId,
  });
  if (finishError) throw finishError;
}

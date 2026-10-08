import type { SupabaseClient } from "@supabase/supabase-js";

export class ViaturaDeletionError extends Error {
  readonly status: number;

  constructor(message: string, status: number = 500) {
    super(message);
    this.name = "ViaturaDeletionError";
    this.status = status;
  }
}

export async function deleteViatura(client: SupabaseClient, id: string) {
  const { data: paths, error: prepareError } = await client.rpc("preparar_exclusao_vtr", { target_id: id });
  if (prepareError) {
    console.error("Falha ao preparar exclusão definitiva de VTR", { id, error: prepareError });
    if (prepareError.code === "23514") {
      throw new ViaturaDeletionError(
        "Os caminhos das fotos desta VTR são inconsistentes. Procure o suporte antes de excluir.",
        409,
      );
    }
    throw new ViaturaDeletionError(
      prepareError.code === "P0002" ? "VTR não encontrada." : "Não foi possível preparar a exclusão da VTR.",
      prepareError.code === "P0002" ? 404 : 500,
    );
  }
  if (!Array.isArray(paths) || !paths.every((path): path is string => typeof path === "string")) {
    console.error("Resposta inválida ao preparar exclusão de VTR", { id });
    throw new ViaturaDeletionError("A rotina de exclusão retornou dados inválidos.");
  }

  for (let offset = 0; offset < paths.length; offset += 100) {
    const { error } = await client.storage.from("fotos-vtr").remove(paths.slice(offset, offset + 100));
    if (error) {
      console.error("Falha ao excluir arquivos da VTR no Storage", { id, error });
      throw new ViaturaDeletionError(
        "A exclusão ainda não foi concluída: não foi possível remover todas as fotos. Tente retirar esta VTR novamente para concluir a limpeza.",
      );
    }
  }

  const { error: finishError } = await client.rpc("concluir_exclusao_vtr", { target_id: id });
  if (finishError) {
    console.error("Falha ao concluir exclusão definitiva de VTR", { id, error: finishError });
    throw new ViaturaDeletionError(
      "A exclusão ainda não foi concluída. Tente retirar esta VTR novamente para concluir a limpeza do banco e do Storage.",
    );
  }
}

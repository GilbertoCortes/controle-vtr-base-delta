import { createClient } from "@supabase/supabase-js";
import { deleteViatura } from "../lib/delete-viatura.ts";

// Ferramenta de transicao, nao e uma area do app para armazenar VTRs retiradas.
process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Configuração administrativa do Supabase indisponível.");
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: viaturas, error } = await client.from("viaturas").select("id, placa").eq("arquivada", true).order("placa");
if (error) throw error;
console.table(viaturas);
if (!process.argv.includes("--confirmar-exclusao-definitiva")) {
  console.log("Somente consulta. Revise as VTRs acima. Para excluí-las, execute novamente com --confirmar-exclusao-definitiva.");
} else {
  for (const viatura of viaturas) {
    await deleteViatura(client, viatura.id);
    console.log(`VTR ${viatura.id}: cadastro, histórico e fotos excluídos permanentemente.`);
  }
}

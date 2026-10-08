import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type PerfilFuncional = {
  id: string;
  nome_completo: string | null;
  rg_id: string | null;
  base: string | null;
  ala: string | null;
  email: string | null;
  perfil: string | null;
  ativo: boolean;
};

export default async function MeuPerfilPage() {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) redirect("/auth/login");

  const { data, error } = await supabase
    .from("profiles")
    .select("id, nome_completo, rg_id, base, ala, email, perfil, ativo")
    .eq("id", authData.user.id)
    .maybeSingle();

  const perfil = data as PerfilFuncional | null;
  const hasMissingData = !perfil?.nome_completo?.trim()
    || !perfil.rg_id?.trim()
    || !perfil.base?.trim()
    || !perfil.ala?.trim();

  return (
    <section className="mx-auto w-full max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
        <h1 className="text-2xl font-semibold text-[#f3f4ef] sm:text-3xl">Meu Perfil</h1>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-[#bd4c4b]/35 bg-[#bd4c4b]/10 p-4 text-sm text-[#f0aaa2]">
          Não foi possível carregar seus dados funcionais.
        </p>
      ) : !perfil ? (
        <p role="alert" className="rounded-md border border-[#bd4c4b]/35 bg-[#bd4c4b]/10 p-4 text-sm text-[#f0aaa2]">
          Seu registro em public.profiles não foi encontrado.
        </p>
      ) : (
        <>
          {hasMissingData && (
            <p className="rounded-md border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
              Seus dados funcionais estão incompletos. Procure um administrador para atualizá-los.
            </p>
          )}
          <div className="space-y-5 rounded-lg border border-white/10 bg-[#192222] p-5 sm:p-7">
            <p className="text-sm text-[#a9b8b1]">
              Dados somente para consulta. Alterações cadastrais devem ser feitas por um administrador em Gerenciar Usuários.
            </p>
            <dl className="grid gap-5 sm:grid-cols-2">
              {[
                ["Nome completo", perfil.nome_completo],
                ["RG / ID funcional", perfil.rg_id],
                ["Base", perfil.base],
                ["ALA", perfil.ala],
                ["E-mail", perfil.email],
                ["Função / Perfil", perfil.perfil === "administrador" ? "Administrador" : perfil.perfil],
                ["Status", perfil.ativo ? "Ativo" : "Inativo"],
              ].map(([label, value]) => (
                <div key={label} className="space-y-2">
                  <dt className="text-sm font-medium text-[#e0e8e3]">{label}</dt>
                  <dd className="break-words text-base text-[#f3f4ef] sm:text-sm">{value?.trim() || "—"}</dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}
    </section>
  );
}
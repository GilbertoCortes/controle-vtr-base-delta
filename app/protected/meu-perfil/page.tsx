import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PerfilFuncionalForm } from "@/components/perfil-funcional-form";

type PerfilFuncional = {
  id: string;
  nome_completo: string | null;
  rg_id: string | null;
  base: string | null;
  ala: string | null;
};

export default async function MeuPerfilPage() {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) redirect("/auth/login");

  const { data, error } = await supabase
    .from("profiles")
    .select("id, nome_completo, rg_id, base, ala")
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
              Complete seus dados funcionais para utilizar o sistema.
            </p>
          )}
          <PerfilFuncionalForm
            initialValues={{
              nome_completo: perfil.nome_completo ?? "",
              rg_id: perfil.rg_id ?? "",
              base: perfil.base ?? "",
              ala: perfil.ala ?? "",
            }}
          />
        </>
      )}
    </section>
  );
}
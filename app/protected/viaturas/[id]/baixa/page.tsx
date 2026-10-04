import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { BaixaVtrForm } from "@/components/baixa-vtr-form";

type Viatura = {
  id: string | number;
  placa: string;
  tipo: string;
  situacao: string;
  quilometragem: number | null;
};

async function BaixaVtrContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) redirect("/auth/login");

  const { data, error } = await supabase
    .from("viaturas")
    .select("id, placa, tipo, situacao, quilometragem")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    return (
      <section className="mx-auto w-full max-w-3xl space-y-5">
        <h1 className="text-2xl font-semibold text-[#f3f4ef]">
          {error ? "Não foi possível carregar a VTR." : "VTR não encontrada."}
        </h1>
      </section>
    );
  }

  const viatura = data as unknown as Viatura;
  if (viatura.situacao.trim().toLowerCase() !== "ativa") {
    return (
      <section className="mx-auto w-full max-w-3xl space-y-5">
        <h1 className="text-2xl font-semibold text-[#f3f4ef]">Esta VTR já está baixada.</h1>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6">
      <h1 className="border-b border-white/10 pb-5 text-2xl font-semibold text-[#f3f4ef] sm:text-3xl">
        Baixar VTR
      </h1>
      <BaixaVtrForm viatura={viatura} />
    </section>
  );
}

export default function BaixaVtrPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-3xl py-10 text-center text-sm text-[#b7c4bd]">
          Carregando dados da VTR...
        </div>
      }
    >
      <BaixaVtrContent params={params} />
    </Suspense>
  );
}
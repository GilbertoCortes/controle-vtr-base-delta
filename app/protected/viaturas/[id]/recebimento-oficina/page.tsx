import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { RecebimentoOficinaForm } from "@/components/recebimento-oficina-form";

type Viatura = {
  id: string | number;
  placa: string;
  tipo: string;
  situacao: string;
};

async function RecebimentoOficinaContent({
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
    .select("id, placa, tipo, situacao")
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
  if (viatura.situacao.trim().toLowerCase() !== "baixada") {
    return (
      <section className="mx-auto w-full max-w-3xl space-y-5">
        <h1 className="text-2xl font-semibold text-[#f3f4ef]">
          Esta VTR não está baixada.
        </h1>
      </section>
    );
  }

  const { data: baixaData } = await supabase
    .from("registros_vtr")
    .select("checklist")
    .eq("viatura_id", viatura.id)
    .eq("tipo_registro", "baixa")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  const baixaChecklist = baixaData?.checklist as Record<string, unknown> | null;
  const motivoBaixa = typeof baixaChecklist?.observacoes === "string"
    && baixaChecklist.observacoes.trim()
    ? baixaChecklist.observacoes
    : "Motivo não informado.";

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6">
      <h1 className="border-b border-white/10 pb-5 text-2xl font-semibold text-[#f3f4ef] sm:text-3xl">
        Receber VTR da Oficina
      </h1>
      <RecebimentoOficinaForm viatura={viatura} motivoBaixa={motivoBaixa} />
    </section>
  );
}

export default function RecebimentoOficinaPage({
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
      <RecebimentoOficinaContent params={params} />
    </Suspense>
  );
}
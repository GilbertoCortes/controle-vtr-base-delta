import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAdminSession } from "@/lib/supabase/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin-server";
import { FinalWithdrawal } from "@/components/final-withdrawal";

async function WithdrawalContent({ params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session.user) redirect("/auth/login");
  if (!session.isAdmin) redirect("/protected");
  const { id } = await params;
  const client = createSupabaseAdminClient();
  const { data: viatura, error } = await client.from("viaturas").select("id, placa, tipo").eq("id", id).maybeSingle();
  const { data: withdrawal, error: withdrawalError } = await client.from("retiradas_vtr").select("fase").eq("viatura_id", id).maybeSingle();
  if (error || withdrawalError || !viatura || (viatura.tipo !== "Viatura" && viatura.tipo !== "Motocicleta")) {
    return <p role="alert" className="text-sm text-[#f0aaa2]">Não foi possível carregar a retirada desta VTR.</p>;
  }
  return (
    <section className="mx-auto w-full max-w-3xl space-y-6">
      <h1 className="border-b border-white/10 pb-5 text-2xl font-semibold text-[#f3f4ef]">VISTORIA FINAL DE RETIRADA</h1>
      <FinalWithdrawal viatura={{ id, placa: viatura.placa, tipo: viatura.tipo, situacao: "ativa" }} hasFinal={Boolean(withdrawal)} />
    </section>
  );
}

export default function WithdrawalPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p className="text-sm text-[#a9b8b1]">Carregando vistoria...</p>}><WithdrawalContent params={params} /></Suspense>;
}

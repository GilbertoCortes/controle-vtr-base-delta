import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAdminSession } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/plate";

type ViaturaRemovida = {
  id: string | number;
  placa: string;
};

async function VtrRemovidasContent() {
  const { supabase, user, isAdmin } = await getAdminSession();

  if (!user) redirect("/auth/login");
  if (!isAdmin) redirect("/protected");

  const { data, error } = await supabase
    .from("viaturas")
    .select("id, placa")
    .eq("arquivada", true)
    .order("placa");
  const viaturas = (data ?? []) as ViaturaRemovida[];

  return (
    <section className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
        <h1 className="text-2xl font-semibold text-[#f3f4ef] sm:text-3xl">
          VIATURAS REMOVIDAS
        </h1>
      </div>

      {error ? (
        <p role="alert" className="py-8 text-center text-sm text-[#f0aaa2]">
          Não foi possível carregar as VTRs removidas.
        </p>
      ) : viaturas.length === 0 ? (
        <p className="py-8 text-center text-sm text-[#b7c4bd]">
          Nenhuma VTR removida.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {viaturas.map((viatura) => (
            <li key={viatura.id}>
              <Link
                href={`/protected/viaturas/${viatura.id}`}
                className="flex min-h-16 items-center justify-center rounded-md border border-white/10 bg-[#192222] px-4 text-lg font-bold tracking-[0.08em] text-[#f3f4ef] transition-colors hover:border-[#d5b45b] hover:bg-[#202b28] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d5b45b]"
              >
                {formatPlate(viatura.placa)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function VtrRemovidasPage() {
  return (
    <Suspense fallback={<p className="py-8 text-center text-sm text-[#a9b8b1]">Carregando viaturas removidas...</p>}>
      <VtrRemovidasContent />
    </Suspense>
  );
}
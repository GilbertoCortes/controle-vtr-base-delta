import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/plate";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

type Viatura = {
  id: string | number;
  placa: string;
  tipo: string;
  situacao: string;
};

async function ProtectedContent() {
  const { supabase, user, isAdmin } = await getAdminSession();
  if (!user) redirect("/auth/login");

  const { data, error } = await supabase
    .from("viaturas")
    .select("id, placa, tipo, situacao")
    .eq("arquivada", false)
    .order("placa");
  const viaturas = (data ?? []) as Viatura[];

  return (
    <section className="w-full">
      <h1 className="mb-8 border-b border-white/10 pb-5 text-2xl font-semibold text-[#f3f4ef] sm:text-3xl">
        Viaturas da Base Delta
      </h1>

      {error ? (
        <div role="alert" className="py-10 text-center text-sm text-[#f0aaa2]">
          <p>
            {error.code === "42501"
              ? "O Supabase negou a leitura de public.viaturas por falta de permissão SELECT."
              : "Não foi possível carregar as viaturas."}
          </p>
          <p className="mt-2 break-words">
            Supabase {error.code}: {error.message}
          </p>
        </div>
      ) : viaturas.length === 0 ? (
        <p className="py-10 text-center text-sm text-[#b7c4bd]">
          Nenhuma VTR cadastrada.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {viaturas.map((viatura) => {
            const situacao = viatura.situacao.trim().toUpperCase();
            const isActive = situacao === "ATIVA";
            const isMoto = viatura.tipo.trim().toLowerCase() === "motocicleta";

            return (
              <li
                key={viatura.id}
                className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#192222] p-3"
              >
                <Link
                  href={`/protected/viaturas/${viatura.id}`}
                  aria-label={`Abrir VTR ${formatPlate(viatura.placa)}`}
                  className="flex min-h-16 min-w-0 flex-1 items-center rounded-md border border-[#40514c] bg-[#111919] px-4 text-[19px] font-bold tracking-[0.08em] text-[#f3f4ef] transition-colors hover:border-[#d5b45b] hover:bg-[#202b28] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d5b45b]"
                >
                  <Image
                    src={isMoto ? "/moto.png" : "/carro.png"}
                    alt=""
                    width={36}
                    height={36}
                    className="size-9 shrink-0 object-contain"
                    aria-hidden="true"
                  />
                  <span className="pl-4">{formatPlate(viatura.placa)}</span>
                </Link>
                <span
                  className={`w-[84px] shrink-0 text-center text-sm font-bold ${
                    isActive ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {isActive ? "ATIVA" : "BAIXADA"}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-8 flex justify-center">
        <Link
          href="/protected/viaturas/nova"
          className="flex min-h-14 w-full max-w-md items-center justify-center rounded-md border border-[#d5b45b]/50 bg-[#d5b45b] px-6 text-base font-bold text-[#17201e] transition-colors hover:bg-[#e2c675] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e2c675]"
        >
          + INSERIR VTR
        </Link>
      </div>
      {isAdmin && (
        <div className="flex justify-center">
          <Link
            href="/protected/removidas"
            className="inline-flex min-h-12 items-center justify-center rounded-md border border-[#40514c] px-5 text-sm font-semibold text-[#e0e8e3] transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d5b45b]"
          >
            VTRs REMOVIDAS
          </Link>
        </div>
      )}
    </section>
  );
}

export default function ProtectedPage() {
  return (
    <Suspense
      fallback={
        <p className="py-10 text-center text-sm text-[#b7c4bd]">
          Carregando viaturas...
        </p>
      }
    >
      <ProtectedContent />
    </Suspense>
  );
}

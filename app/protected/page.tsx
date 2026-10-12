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
  const { supabase, user } = await getAdminSession();
  if (!user) redirect("/auth/login");

  const { data, error } = await supabase
    .from("viaturas")
    .select("id, placa, tipo, situacao")
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
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {viaturas.map((viatura) => {
            const situacao = viatura.situacao.trim().toUpperCase();
            const isActive = situacao === "ATIVA";
            const isBaixada = situacao === "BAIXADA";
            const isMoto = viatura.tipo.trim().toLowerCase() === "motocicleta";

            return (
              <li
                key={viatura.id}
                className={`flex items-center gap-2 rounded-lg border p-3 md:gap-3 ${
                  isBaixada ? "border-[#bd4c4b]/40 bg-[#bd4c4b]/10" : "border-white/10 bg-[#192222]"
                }`}
              >
                <Link
                  href={`/protected/viaturas/${viatura.id}`}
                  prefetch={false}
                  aria-label={`Abrir VTR ${formatPlate(viatura.placa)}`}
                  className={`flex min-h-16 min-w-0 flex-1 items-center rounded-md border px-2 text-[19px] font-bold tracking-[0.08em] text-[#f3f4ef] transition-colors focus-visible:outline-none focus-visible:ring-2 md:px-4 ${
                    isBaixada
                      ? "border-[#bd4c4b]/50 bg-[#bd4c4b]/10 hover:border-[#bd4c4b] hover:bg-[#bd4c4b]/20 focus-visible:ring-[#ef9691]"
                      : "border-[#40514c] bg-[#111919] hover:border-[#d5b45b] hover:bg-[#202b28] focus-visible:ring-[#d5b45b]"
                  }`}
                >
                  <Image
                    src={isMoto ? "/moto.png" : "/carro.png"}
                    alt=""
                    width={36}
                    height={36}
                    className="size-9 shrink-0 object-contain"
                    aria-hidden="true"
                  />
                  <span className="shrink-0 whitespace-nowrap pl-2 md:pl-4">{formatPlate(viatura.placa)}</span>
                </Link>
                <span
                  className={`w-16 shrink-0 text-center text-sm font-bold md:w-[84px] ${
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

import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { InitialCheckinForm } from "@/components/initial-checkin-form";

async function ProtectedInitialCheckin() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  return (
    <section className="mx-auto w-full max-w-3xl">
      <h1 className="mb-7 border-b border-white/10 pb-5 text-2xl font-semibold text-[#f3f4ef] sm:text-3xl">
        Check-in/Entrada de VTR
      </h1>
      <InitialCheckinForm />
    </section>
  );
}

export default function InitialCheckinPage() {
  return (
    <Suspense
      fallback={
        <section className="mx-auto w-full max-w-3xl">
          <h1 className="mb-7 border-b border-white/10 pb-5 text-2xl font-semibold text-[#f3f4ef] sm:text-3xl">
            Check-in/Entrada de VTR
          </h1>
          <p className="py-8 text-center text-sm text-[#a9b8b1]">
            Carregando check-in...
          </p>
        </section>
      }
    >
      <ProtectedInitialCheckin />
    </Suspense>
  );
}
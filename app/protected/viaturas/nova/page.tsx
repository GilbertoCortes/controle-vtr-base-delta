import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewViaturaForm } from "@/components/new-viatura-form";

export default async function NewViaturaPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  return (
    <section className="mx-auto w-full max-w-xl">
      <h1 className="mb-7 border-b border-white/10 pb-5 text-2xl font-semibold text-[#f3f4ef] sm:text-3xl">
        Inserir VTR
      </h1>
      <NewViaturaForm />
    </section>
  );
}
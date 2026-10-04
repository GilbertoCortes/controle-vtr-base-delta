import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAdminSession } from "@/lib/supabase/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin-server";
import { AdminUsersManager, type UsuarioPerfil } from "@/components/admin-users-manager";

async function GerenciarUsuariosContent() {
  const { user, isAdmin } = await getAdminSession();
  if (!user) redirect("/auth/login");
  if (!isAdmin) redirect("/protected");

  let users: UsuarioPerfil[] = [];
  let listError: string | null = null;

  try {
    const adminClient = createSupabaseAdminClient();
    const { data, error } = await adminClient
      .from("profiles")
      .select("id, email, nome_completo, rg_id, base, ala, perfil, ativo")
      .order("nome_completo");

    if (error) {
      console.error("ERRO PROFILES:", {
        message: error?.message ?? "não informado",
        code: error?.code ?? "não informado",
        details: error?.details ?? "não informado",
        hint: error?.hint ?? "não informado",
        fullError: error,
      });
      listError = [
        "Erro ao carregar usuários",
        `code: ${error?.code ?? "não informado"}`,
        `message: ${error?.message ?? "não informado"}`,
        `details: ${error?.details ?? "não informado"}`,
        `hint: ${error?.hint ?? "não informado"}`,
      ].join("\n");
    } else {
      users = (data ?? []) as UsuarioPerfil[];
    }
  } catch {
    listError = "A área administrativa não está configurada no servidor.";
  }

  return (
    <section className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
        <h1 className="text-2xl font-semibold text-[#f3f4ef] sm:text-3xl">
          Gerenciar Usuários
        </h1>
      </div>
      <AdminUsersManager
        users={users}
        currentUserId={user.id}
        isAdmin={isAdmin}
        listError={listError}
      />
    </section>
  );
}

export default function GerenciarUsuariosPage() {
  return (
    <Suspense fallback={<p className="py-8 text-center text-sm text-[#a9b8b1]">Carregando usuários...</p>}>
      <GerenciarUsuariosContent />
    </Suspense>
  );
}
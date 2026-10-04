import { AuthButton } from "@/components/auth-button";
import { BackButton } from "@/components/back-button";
import { getAdminSession } from "@/lib/supabase/admin";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

export const instant = false;

async function AdminUsersLink() {
  const { isAdmin } = await getAdminSession();
  if (!isAdmin) return null;

  return (
    <Link
      href="/protected/usuarios"
      className="text-sm font-medium text-[#a9b8b1] transition-colors hover:text-[#f3f4ef]"
    >
      GERENCIAR USUÁRIOS
    </Link>
  );
}

async function ActiveAccountContent({ children }: { children: React.ReactNode }) {
  const { user, isActive } = await getAdminSession();
  if (!user) redirect("/auth/login");

  if (!isActive) {
    return (
      <section className="mx-auto w-full max-w-3xl rounded-md border border-amber-400/30 bg-amber-400/10 p-5 text-center text-sm text-amber-100">
        Seu acesso ao sistema está desativado. Procure um administrador.
      </section>
    );
  }

  return children;
}

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-svh bg-[#101719] text-[#edf2ef]">
      <header className="border-b border-white/10 bg-[#141d1d]">
        <nav className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5 sm:px-8">
          <span className="text-sm font-semibold text-[#f3f4ef]">
            Controle de VTR <span className="font-normal text-[#91a19a]">/ Base Delta</span>
          </span>
          <div className="flex items-center gap-4">
            <Suspense fallback={null}>
              <AdminUsersLink />
            </Suspense>
            <Link
              href="/protected/meu-perfil"
              className="text-sm text-[#a9b8b1] transition-colors hover:text-[#f3f4ef]"
            >
              Meu Perfil
            </Link>
            <Suspense>
              <AuthButton />
            </Suspense>
          </div>
        </nav>
      </header>
      <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
        <Suspense fallback={<p className="py-8 text-center text-sm text-[#a9b8b1]">Carregando...</p>}>
          <ActiveAccountContent>
            <BackButton />
            {children}
          </ActiveAccountContent>
        </Suspense>
      </div>
    </main>
  );
}

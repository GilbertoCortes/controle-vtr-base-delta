"use client";

import { createClient } from "@/lib/supabase/client";
import { clearDraftsForUser, resetDraftUserCache } from "@/lib/draft-storage";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  const logout = async () => {
    const supabase = createClient();
    // Captura o UUID antes de encerrar a sessao para limpar apenas os
    // rascunhos deste usuario. Nao usa sessionStorage.clear().
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id ?? null;
    if (userId) clearDraftsForUser(userId);
    resetDraftUserCache();
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  return <Button onClick={logout}>Sair</Button>;
}

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function getAdminSession() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const user = error ? null : data.user;

  if (!user) {
    return {
      supabase,
      user: null,
      isAdmin: false,
      isActive: false,
      perfilAtual: null,
      hasProfile: false,
      profileLookupFailed: false,
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("perfil, ativo")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Falha ao consultar public.profiles:", {
      message: profileError.message,
      code: profileError.code,
      details: profileError.details,
      userId: user.id,
    });
  }

  return {
    supabase,
    user,
    perfilAtual: profile?.perfil ?? null,
    isActive: !profileError && profile?.ativo === true,
    isAdmin: !profileError && profile?.ativo === true && profile?.perfil === "administrador",
    hasProfile: Boolean(profile),
    profileLookupFailed: Boolean(profileError),
  };
}

export async function requireActiveSession() {
  const session = await getAdminSession();
  if (!session.user) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "Sessão inválida. Entre novamente." }, { status: 401 }),
    };
  }
  if (session.profileLookupFailed) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "Não foi possível verificar o status do usuário." }, { status: 503 }),
    };
  }
  if (!session.hasProfile) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "Usuário desativado." }, { status: 403 }),
    };
  }
  if (!session.isActive) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "Usuário desativado." }, { status: 403 }),
    };
  }
  return {
    ok: true as const,
    supabase: session.supabase,
    user: session.user,
    isAdmin: session.isAdmin,
  };
}
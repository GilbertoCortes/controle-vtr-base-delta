import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/supabase/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin-server";

type InvitePayload = {
  nome_completo?: unknown;
  rg_id?: unknown;
  base?: unknown;
  ala?: unknown;
  email?: unknown;
  perfil?: unknown;
  password?: unknown;
};

export async function POST(request: Request) {
  const session = await requireActiveSession();
  if (!session.ok) return session.response;
  if (!session.isAdmin) {
    return NextResponse.json({ message: "Ação permitida somente para administradores." }, { status: 403 });
  }

  let payload: InvitePayload;
  try {
    payload = (await request.json()) as InvitePayload;
  } catch {
    return NextResponse.json({ message: "Dados do convite inválidos." }, { status: 400 });
  }

  const nomeCompleto = typeof payload.nome_completo === "string" ? payload.nome_completo.trim() : "";
  const rgId = typeof payload.rg_id === "string" ? payload.rg_id.trim() : "";
  const base = typeof payload.base === "string" ? payload.base.trim() : "";
  const ala = typeof payload.ala === "string" ? payload.ala.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const perfil = payload.perfil;
  const password = typeof payload.password === "string" ? payload.password : "";

  if (!nomeCompleto || !rgId || !base || !ala || !email || !password) {
    return NextResponse.json({ message: "Preencha todos os campos obrigatórios." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ message: "A senha deve ter pelo menos 8 caracteres." }, { status: 400 });
  }
  if (perfil !== "usuario" && perfil !== "administrador") {
    return NextResponse.json({ message: "Selecione um perfil válido." }, { status: 400 });
  }

  try {
    const adminClient = createSupabaseAdminClient();
    const { data, error: createUserError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createUserError || !data.user) {
      console.error("Falha ao criar usuário autorizado", {
        message: createUserError?.message,
        code: createUserError?.code,
      });
      const alreadyExists = createUserError?.message.toLowerCase().includes("already")
        || createUserError?.message.toLowerCase().includes("registered");
      return NextResponse.json(
        {
          message: alreadyExists
            ? "Este e-mail já possui usuário no sistema."
            : "Não foi possível criar o usuário. Verifique os dados e tente novamente.",
        },
        { status: 400 },
      );
    }

    const { error: profileError } = await adminClient
      .from("profiles")
      .upsert(
        {
          id: data.user.id,
          email,
          nome_completo: nomeCompleto,
          rg_id: rgId,
          base,
          ala,
          perfil,
        },
        { onConflict: "id" },
      );

    if (profileError) {
      const { error: cleanupError } = await adminClient.auth.admin.deleteUser(data.user.id);
      console.error("Falha ao salvar public.profiles após criar usuário", {
        message: profileError.message,
        code: profileError.code,
        authCleanupError: cleanupError?.message ?? null,
      });
      return NextResponse.json(
        {
          message: cleanupError
            ? "Não foi possível salvar os dados funcionais e remover o usuário recém-criado. Contate o administrador do sistema."
            : "Não foi possível salvar os dados funcionais. O usuário recém-criado foi removido; tente novamente.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ message: "Usuário cadastrado com sucesso." }, { status: 201 });
  } catch (error) {
    console.error("Falha ao cadastrar usuário", error);
    return NextResponse.json(
      { message: "Não foi possível cadastrar o usuário. Verifique a configuração administrativa do servidor." },
      { status: 500 },
    );
  }
}
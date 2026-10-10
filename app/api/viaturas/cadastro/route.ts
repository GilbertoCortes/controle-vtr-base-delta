import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/supabase/admin";
import { isStrictMercosulPlate } from "@/lib/plate";
import { rollbackVtrOperation } from "@/lib/rollback-vtr-operation";
import { inspectionFields, validateInspectionAnswers } from "@/lib/vtr-inspection";
import { prepareInspectionPhotos, type PreparedInspectionPhoto } from "@/lib/inspection-photos-server";

const photoBucket = "fotos-vtr";

type SavePayload = {
  viatura?: {
    placa?: unknown;
    tipo?: unknown;
  };
  checkin?: {
    answers?: unknown;
    observacoes?: unknown;
    photos?: unknown;
  };
};

function errorFields(error: unknown) {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  return {
    code: typeof value.code === "string" ? value.code : null,
    details: typeof value.details === "string" ? value.details : null,
    hint: typeof value.hint === "string" ? value.hint : null,
  };
}

export async function POST(request: Request) {
  const session = await requireActiveSession();
  if (!session.ok) return session.response;
  const { supabase, user } = session;

  let payload: SavePayload;
  try {
    const input: unknown = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return NextResponse.json({ message: "Dados do cadastro inválidos." }, { status: 400 });
    }
    payload = input as SavePayload;
  } catch {
    return NextResponse.json(
      { message: "Não foi possível ler os dados do cadastro. Revise o formulário." },
      { status: 400 },
    );
  }

  const viatura = payload.viatura;
  const placaRaw = typeof viatura?.placa === "string" ? viatura.placa : "";
  const placa = placaRaw.toUpperCase();
  const tipo = viatura?.tipo;
  const answers = payload.checkin?.answers;

  if (!isStrictMercosulPlate(placa)) {
    return NextResponse.json(
      { message: "Placa inválida. Use o formato KKK5K55." },
      { status: 400 },
    );
  }
  if (tipo !== "Viatura" && tipo !== "Motocicleta") {
    return NextResponse.json(
      { message: "Selecione um tipo de VTR válido." },
      { status: 400 },
    );
  }
  const inspectionError = validateInspectionAnswers(answers, tipo);
  if (inspectionError) return NextResponse.json({ message: inspectionError }, { status: 400 });
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return NextResponse.json(
      { message: "Preencha os campos obrigatórios do check-in inicial." },
      { status: 400 },
    );
  }

  const checkinAnswers = answers as Record<string, unknown>;
  const km = Number(checkinAnswers.km_atual);
  if (!Number.isSafeInteger(km) || km < 0) {
    return NextResponse.json(
      { message: "Informe um KM atual válido." },
      { status: 400 },
    );
  }

  const requiredFields = inspectionFields(tipo);
  for (const [field, options] of Object.entries(requiredFields)) {
    if (
      typeof checkinAnswers[field] !== "string" ||
      !options.includes(checkinAnswers[field] as string)
    ) {
      return NextResponse.json(
        { message: "Preencha todos os campos obrigatórios do check-in inicial." },
        { status: 400 },
      );
    }
  }
  const combustivel = (checkinAnswers.combustivel as string).toLowerCase();
  const oleoMotor = (checkinAnswers.oleo_motor as string).toLowerCase();
  const liquidoArrefecimento = (checkinAnswers.liquido_arrefecimento as string).toLowerCase();
  const observacoes = typeof payload.checkin?.observacoes === "string"
    ? payload.checkin.observacoes.trim()
    : "";
  const checklist: Record<string, unknown> = {
    km_atual: km,
    combustivel,
    oleo_motor: oleoMotor,
    liquido_arrefecimento: liquidoArrefecimento,
    observacoes,
  };
  for (const field of Object.keys(requiredFields)) {
    if (field !== "combustivel" && field !== "oleo_motor" && field !== "liquido_arrefecimento") {
      checklist[field] = checkinAnswers[field];
    }
  }

  let photos: PreparedInspectionPhoto[];
  try {
    photos = prepareInspectionPhotos(payload.checkin?.photos);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Fotos inválidas." },
      { status: 400 },
    );
  }

  const { data: existing, error: lookupError } = await supabase
    .from("viaturas")
    .select("id")
    .ilike("placa", placa)
    .maybeSingle();
  if (lookupError) {
    return NextResponse.json(
      { message: "Não foi possível verificar se a placa já está cadastrada. Tente novamente." },
      { status: 500 },
    );
  }
  if (existing) {
    return NextResponse.json(
      { message: "Esta placa já está cadastrada." },
      { status: 409 },
    );
  }
  const viaturaData: Record<string, string | number> = {
    placa,
    tipo,
    situacao: "ativa",
    quilometragem: km,
  };

  const { data: createdViatura, error: viaturaError } = await supabase
    .from("viaturas")
    .insert(viaturaData)
    .select("id")
    .single();

  if (viaturaError || !createdViatura) {
    console.error("Erro completo ao inserir em public.viaturas:", viaturaError);
    const duplicate = viaturaError?.code === "23505";
    const errorInfo = viaturaError as unknown as Record<string, unknown> | null;
    const constraintName = typeof errorInfo?.constraint === "string" ? errorInfo.constraint : "";
    const diagnostic = [constraintName, viaturaError?.message, viaturaError?.details, viaturaError?.hint]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
    const duplicateField = /viaturas_placa_key|key\s*\(\s*placa\s*\)/i.test(diagnostic)
      ? "placa"
      : null;
    return NextResponse.json(
      {
        message: duplicateField === "placa"
          ? "Esta placa já está cadastrada."
          : duplicate
            ? "Não foi possível criar a VTR porque um valor único já está cadastrado. Verifique a placa."
            : viaturaError?.message ?? "Não foi possível criar a VTR.",
        code: viaturaError?.code ?? null,
        details: viaturaError?.details ?? null,
        hint: viaturaError?.hint ?? null,
      },
      { status: duplicate ? 409 : 500 },
    );
  }

  const createdViaturaId = createdViatura.id;
  let registroId: string | number | null = null;
  const attemptedPaths: string[] = [];

  try {
    const { data: registro, error: registroError } = await supabase
      .from("registros_vtr")
      .insert({
        viatura_id: createdViatura.id,
        tipo_registro: "checkin_inicial",
        usuario_id: user.id,
        km,
        combustivel,
        oleo_motor: oleoMotor,
        liquido_arrefecimento: liquidoArrefecimento,
        checklist,
      })
      .select("id")
      .single();
    if (registroError) throw registroError;
    registroId = registro.id;

    for (const photo of photos) {
      const path = `${createdViatura.id}/${registroId}/${randomUUID()}.${photo.extension}`;
      attemptedPaths.push(path);
      const { error: uploadError } = await supabase.storage
        .from(photoBucket)
        .upload(path, photo.bytes, { contentType: photo.contentType, upsert: false });
      if (uploadError) throw uploadError;

      const { error: fotoError } = await supabase
        .from("fotos_registro_vtr")
        .insert({ registro_id: registroId, caminho_storage: path, categoria: photo.categoria })
        .select("id")
        .single();
      if (fotoError) throw fotoError;
    }
  } catch (error) {
    const rollbackSucceeded = await rollbackVtrOperation({
      viaturaId: createdViaturaId, registroId, attemptedPaths, deleteCreatedViatura: true,
    });
    console.error("Falha ao persistir check-in inicial da VTR", { error, rollbackSucceeded });
    return NextResponse.json(
      {
        message: rollbackSucceeded
          ? "Não foi possível salvar o check-in/entrada da VTR. A VTR recém-criada foi removida; revise os dados e tente novamente."
          : "O check-in/entrada falhou e a reversão automática ficou incompleta. Procure o suporte antes de tentar novamente.",
        ...errorFields(error),
      },
      { status: 500 },
    );
  }

  revalidatePath("/protected");
  revalidatePath(`/protected/viaturas/${createdViatura.id}`);
  return NextResponse.json(
    { id: createdViatura.id, placa, registroId, tipo_registro: "checkin_inicial" },
    { status: 201 },
  );
}
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/supabase/admin";
import { normalizePlate } from "@/lib/plate";

type TipoViatura = "Viatura" | "Motocicleta";
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

type PreparedPhoto = {
  contentType: string;
  extension: string;
  bytes: Buffer;
};

const conditionOptions = ["OK", "Ruim"];
const possessionOptions = ["Possui", "Não possui"];
const optionalConditionOptions = ["OK", "Ruim", "Não possui"];
const fuelOptions = ["Vazio", "1/4", "1/2", "3/4", "Cheio"];

function preparePhotos(value: unknown): PreparedPhoto[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const photos: PreparedPhoto[] = [];
  for (const item of value) {
    if (!item || typeof item.dataUrl !== "string") return null;
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      item.dataUrl,
    );
    if (!match) return null;
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) return null;
    photos.push({
      contentType: match[1],
      extension: match[1] === "image/png" ? "png" : match[1] === "image/webp" ? "webp" : "jpg",
      bytes,
    });
  }
  return photos;
}

function errorFields(error: unknown) {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  return {
    code: typeof value.code === "string" ? value.code : null,
    details: typeof value.details === "string" ? value.details : null,
    hint: typeof value.hint === "string" ? value.hint : null,
  };
}

function allowedChecklistFields(tipo: TipoViatura) {
  const fields: Record<string, readonly string[]> = {
    oleo_motor: ["Bom", "Inapropriado"],
    liquido_arrefecimento: ["Bom", "Inapropriado"],
    combustivel: fuelOptions,
    seta_dianteira_direita: conditionOptions,
    seta_dianteira_esquerda: conditionOptions,
    seta_traseira_direita: conditionOptions,
    seta_traseira_esquerda: conditionOptions,
    luz_freio: conditionOptions,
    luz_alerta: conditionOptions,
    farol_alto: conditionOptions,
    farol_baixo: conditionOptions,
    buzina: conditionOptions,
    strobo: optionalConditionOptions,
    sirene: optionalConditionOptions,
    giroflex: optionalConditionOptions,
    retrovisor_direito: possessionOptions,
    retrovisor_esquerdo: possessionOptions,
  };

  if (tipo === "Viatura") {
    Object.assign(fields, {
      pneu_dianteiro_esquerdo: conditionOptions,
      pneu_dianteiro_direito: conditionOptions,
      pneu_traseiro_esquerdo: conditionOptions,
      pneu_traseiro_direito: conditionOptions,
      estepe: possessionOptions,
      triangulo: possessionOptions,
      chave_roda: possessionOptions,
    });
  } else {
    Object.assign(fields, {
      pneu_dianteiro: conditionOptions,
      pneu_traseiro: conditionOptions,
    });
  }

  return fields;
}

export async function POST(request: Request) {
  const session = await requireActiveSession();
  if (!session.ok) return session.response;
  const { supabase, user } = session;

  let payload: SavePayload;
  try {
    payload = (await request.json()) as SavePayload;
  } catch {
    return NextResponse.json(
      { message: "Não foi possível ler os dados do cadastro. Revise o formulário." },
      { status: 400 },
    );
  }

  const viatura = payload.viatura;
  const placaRaw = typeof viatura?.placa === "string" ? viatura.placa : "";
  const placa = normalizePlate(placaRaw);
  const tipo = viatura?.tipo;
  const answers = payload.checkin?.answers;

  if (!/^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(placa)) {
    return NextResponse.json(
      { message: "Digite uma placa válida no formato ABC-1D23." },
      { status: 400 },
    );
  }
  if (tipo !== "Viatura" && tipo !== "Motocicleta") {
    return NextResponse.json(
      { message: "Selecione um tipo de VTR válido." },
      { status: 400 },
    );
  }
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

  const requiredFields = allowedChecklistFields(tipo);
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

  const photos = preparePhotos(payload.checkin?.photos);
  if (!photos) {
    return NextResponse.json(
      { message: "Uma das fotos do check-in não pôde ser processada. Remova-a e tente novamente." },
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
  const uploadedPaths: string[] = [];
  const fotoIds: (string | number)[] = [];

  async function rollback() {
    let rollbackFailed = false;
    try {
      if (fotoIds.length) {
        const { error } = await supabase.from("fotos_registro_vtr").delete().in("id", fotoIds);
        if (error) rollbackFailed = true;
      }
    } catch {
      rollbackFailed = true;
    }
    try {
      if (uploadedPaths.length) {
        const { error } = await supabase.storage.from(photoBucket).remove(uploadedPaths);
        if (error) rollbackFailed = true;
      }
    } catch {
      rollbackFailed = true;
    }
    try {
      if (registroId !== null) {
        const { error } = await supabase.from("registros_vtr").delete().eq("id", registroId);
        if (error) rollbackFailed = true;
      }
    } catch {
      rollbackFailed = true;
    }
    try {
      const { error } = await supabase.from("viaturas").delete().eq("id", createdViaturaId);
      if (error) rollbackFailed = true;
    } catch {
      rollbackFailed = true;
    }
    return !rollbackFailed;
  }

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
      const { error: uploadError } = await supabase.storage
        .from(photoBucket)
        .upload(path, photo.bytes, { contentType: photo.contentType, upsert: false });
      if (uploadError) throw uploadError;
      uploadedPaths.push(path);

      const { data: foto, error: fotoError } = await supabase
        .from("fotos_registro_vtr")
        .insert({ registro_id: registroId, caminho_storage: path })
        .select("id")
        .single();
      if (fotoError) throw fotoError;
      fotoIds.push(foto.id);
    }
  } catch (error) {
    const rollbackSucceeded = await rollback();
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
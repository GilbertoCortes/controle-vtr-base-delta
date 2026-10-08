import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/supabase/admin";
import { KmRegressionError, kmRegressionMessage } from "@/lib/vtr-km";
import { rollbackVtrOperation } from "@/lib/rollback-vtr-operation";

const conditionOptions = ["OK", "Ruim"];
const possessionOptions = ["Possui", "Não possui"];
const optionalConditionOptions = ["OK", "Ruim", "Não possui"];
const fuelOptions = ["Vazio", "1/4", "1/2", "3/4", "Cheio"];

type RecebimentoPayload = {
  answers?: unknown;
  observacoes?: unknown;
  reparosRealizados?: unknown;
  descricaoReparos?: unknown;
  empresa?: unknown;
  responsavelEntrega?: unknown;
  cpfResponsavelEntrega?: unknown;
  photos?: unknown;
};

type PreparedPhoto = {
  contentType: string;
  extension: string;
  bytes: Buffer;
};

function requiredChecklistFields(tipo: "Viatura" | "Motocicleta") {
  const fields: Record<string, readonly string[]> = {
    oleo_motor: ["Bom", "Inapropriado"],
    liquido_arrefecimento: ["Bom", "Inapropriado"],
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

function preparePhotos(value: unknown): PreparedPhoto[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const result: PreparedPhoto[] = [];
  for (const item of value) {
    if (!item || typeof item.dataUrl !== "string") return null;
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      item.dataUrl,
    );
    if (!match) return null;
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) return null;
    result.push({
      contentType: match[1],
      extension: match[1] === "image/png" ? "png" : match[1] === "image/webp" ? "webp" : "jpg",
      bytes,
    });
  }
  return result;
}

function errorFields(error: unknown) {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  return {
    code: typeof value.code === "string" ? value.code : null,
    details: typeof value.details === "string" ? value.details : null,
    hint: typeof value.hint === "string" ? value.hint : null,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireActiveSession();
  if (!session.ok) return session.response;
  const { supabase, user } = session;

  const { id } = await params;
  let payload: RecebimentoPayload;
  try {
    payload = (await request.json()) as RecebimentoPayload;
  } catch {
    return NextResponse.json({ message: "Não foi possível ler os dados do recebimento." }, { status: 400 });
  }

  const answers = payload.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return NextResponse.json({ message: "Preencha todos os campos obrigatórios." }, { status: 400 });
  }
  const values = answers as Record<string, unknown>;
  const km = Number(values.km_atual);
  if (!Number.isSafeInteger(km) || km < 0) {
    return NextResponse.json({ message: "Informe um KM atual válido." }, { status: 400 });
  }

  const reparosRealizados = payload.reparosRealizados;
  const descricaoReparos = typeof payload.descricaoReparos === "string"
    ? payload.descricaoReparos.trim()
    : "";
  const empresa = typeof payload.empresa === "string" ? payload.empresa.trim() : "";
  const responsavelEntrega = typeof payload.responsavelEntrega === "string"
    ? payload.responsavelEntrega.trim()
    : "";
  const cpf = typeof payload.cpfResponsavelEntrega === "string"
    ? payload.cpfResponsavelEntrega.replace(/\D/g, "")
    : "";
  const observacoes = typeof payload.observacoes === "string" ? payload.observacoes.trim() : "";

  if (reparosRealizados !== "Sim" && reparosRealizados !== "Não") {
    return NextResponse.json({ message: "Informe se foram realizados reparos." }, { status: 400 });
  }
  if (reparosRealizados === "Sim" && !descricaoReparos) {
    return NextResponse.json({ message: "Descreva os reparos realizados." }, { status: 400 });
  }
  if (!empresa || !responsavelEntrega) {
    return NextResponse.json({ message: "Informe a empresa e o responsável pela entrega." }, { status: 400 });
  }
  if (!/^\d{11}$/.test(cpf)) {
    return NextResponse.json({ message: "Informe um CPF válido com 11 dígitos." }, { status: 400 });
  }

  const { data: viatura, error: viaturaError } = await supabase
    .from("viaturas")
    .select("id, tipo, situacao, quilometragem")
    .eq("id", id)
    .maybeSingle();
  if (viaturaError) {
    return NextResponse.json(
      { message: "Não foi possível carregar a VTR.", ...errorFields(viaturaError) },
      { status: 500 },
    );
  }
  if (!viatura) return NextResponse.json({ message: "VTR não encontrada." }, { status: 404 });
  if (typeof viatura.situacao !== "string" || viatura.situacao.trim().toLowerCase() !== "baixada") {
    return NextResponse.json({ message: "Esta VTR não está baixada." }, { status: 409 });
  }
  if (viatura.tipo !== "Viatura" && viatura.tipo !== "Motocicleta") {
    return NextResponse.json({ message: "O tipo cadastrado para esta VTR não é válido." }, { status: 400 });
  }

  const kmAtual = typeof viatura.quilometragem === "number" ? viatura.quilometragem : null;
  if (kmAtual !== null && km < kmAtual) {
    return NextResponse.json({ message: kmRegressionMessage(kmAtual) }, { status: 409 });
  }

  const requiredFields = requiredChecklistFields(viatura.tipo);
  for (const [field, options] of Object.entries(requiredFields)) {
    if (typeof values[field] !== "string" || !options.includes(values[field] as string)) {
      return NextResponse.json({ message: "Preencha todos os itens obrigatórios do checklist." }, { status: 400 });
    }
  }
  if (typeof values.combustivel !== "string" || !fuelOptions.includes(values.combustivel)) {
    return NextResponse.json({ message: "Selecione um combustível válido." }, { status: 400 });
  }
  const combustivel = values.combustivel.toLowerCase();
  const oleoMotor = (values.oleo_motor as string).toLowerCase();
  const liquidoArrefecimento = (values.liquido_arrefecimento as string).toLowerCase();

  const photos = preparePhotos(payload.photos);
  if (!photos) {
    return NextResponse.json({ message: "Uma das fotos não pôde ser processada." }, { status: 400 });
  }

  const reparosBool = reparosRealizados === "Sim";
  const checklist: Record<string, unknown> = {
    ...values,
    km_atual: km,
    combustivel,
    oleo_motor: oleoMotor,
    liquido_arrefecimento: liquidoArrefecimento,
    observacoes,
    reparos_realizados: reparosBool,
    descricao_reparos: descricaoReparos || null,
  };

  let registroId: string | number | null = null;
  const attemptedPaths: string[] = [];

  try {
    const registroValues = {
      viatura_id: viatura.id,
      tipo_registro: "recebimento",
      km,
      combustivel,
      oleo_motor: oleoMotor,
      liquido_arrefecimento: liquidoArrefecimento,
      checklist,
      reparos_realizados: reparosBool,
      descricao_reparos: descricaoReparos || null,
      empresa,
      responsavel_entrega: responsavelEntrega,
      cpf_responsavel_entrega: cpf,
      usuario_id: user.id,
    };

    console.log("DADOS INSERT RECEBIMENTO VTR:", {
      tipo_registro: registroValues.tipo_registro,
      km: registroValues.km,
      combustivel: registroValues.combustivel,
      oleo_motor: registroValues.oleo_motor,
      liquido_arrefecimento: registroValues.liquido_arrefecimento,
    });

    const { data: registro, error: registroError } = await supabase
      .from("registros_vtr")
      .insert(registroValues)
      .select("id")
      .single();
    if (registroError) {
      console.error("ERRO RECEBIMENTO VTR:", {
        message: registroError.message,
        code: registroError.code,
        details: registroError.details,
        hint: registroError.hint,
      });
      return NextResponse.json(
        {
          message: registroError.message,
          code: registroError.code,
          details: registroError.details,
          hint: registroError.hint,
        },
        { status: 500 },
      );
    }
    registroId = registro.id;

    for (const photo of photos) {
      const path = `${viatura.id}/${registroId}/${randomUUID()}.${photo.extension}`;
      attemptedPaths.push(path);
      const { error: uploadError } = await supabase.storage
        .from("fotos-vtr")
        .upload(path, photo.bytes, { contentType: photo.contentType, upsert: false });
      if (uploadError) throw uploadError;

      const { error: fotoError } = await supabase
        .from("fotos_registro_vtr")
        .insert({ registro_id: registroId, caminho_storage: path })
        .select("id")
        .single();
      if (fotoError) throw fotoError;
    }

    const { data: updated, error: updateError } = await supabase
      .from("viaturas")
      .update({
        situacao: "ativa",
        quilometragem: km,
        motivo_situacao: null,
        atualizado_em: new Date().toISOString(),
      })
      .eq("id", viatura.id)
      .eq("situacao", viatura.situacao)
      .or(`quilometragem.is.null,quilometragem.lte.${km}`)
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) {
      const { data: atual } = await supabase
        .from("viaturas")
        .select("quilometragem")
        .eq("id", viatura.id)
        .maybeSingle();
      if (atual && typeof atual.quilometragem === "number" && atual.quilometragem > km) {
        throw new KmRegressionError(atual.quilometragem);
      }
      throw new Error("A situação da VTR mudou antes da conclusão do recebimento.");
    }
  } catch (error) {
    const rollbackSucceeded = await rollbackVtrOperation({ viaturaId: viatura.id, registroId, attemptedPaths });
    if (error instanceof KmRegressionError) {
      console.error("Regressão de quilometragem bloqueada no recebimento", { rollbackSucceeded });
      return NextResponse.json({ message: error.message }, { status: 409 });
    }
    console.error("Falha ao receber VTR da oficina", { error, rollbackSucceeded });
    return NextResponse.json(
      {
        message: rollbackSucceeded
          ? "Não foi possível receber a VTR. Os dados do formulário foram preservados."
          : "O recebimento falhou e a limpeza automática ficou incompleta. Os dados foram preservados; procure o suporte antes de tentar novamente.",
        ...errorFields(error),
      },
      { status: 500 },
    );
  }

  revalidatePath(`/protected/viaturas/${id}`);
  revalidatePath("/protected");
  return NextResponse.json({ message: "VTR recebida da oficina com sucesso." }, { status: 201 });
}
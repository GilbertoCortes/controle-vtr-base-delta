import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/supabase/admin";
import { kmRegressionMessage } from "@/lib/vtr-km";
import { rollbackVtrOperation } from "@/lib/rollback-vtr-operation";

const photoBucket = "fotos-vtr";
const conditionOptions = ["OK", "Ruim"];
const possessionOptions = ["Possui", "Não possui"];
const optionalConditionOptions = ["OK", "Ruim", "Não possui"];
const fuelOptions = ["Vazio", "1/4", "1/2", "3/4", "Cheio"];

type BaixaPayload = {
  answers?: unknown;
  motivoObservacoes?: unknown;
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
  let payload: BaixaPayload;
  try {
    payload = (await request.json()) as BaixaPayload;
  } catch {
    return NextResponse.json({ message: "Não foi possível ler os dados da baixa." }, { status: 400 });
  }

  const answers = payload.answers;
  const motivo = typeof payload.motivoObservacoes === "string"
    ? payload.motivoObservacoes.trim()
    : "";
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return NextResponse.json({ message: "Preencha os campos obrigatórios da baixa." }, { status: 400 });
  }
  if (!motivo) {
    return NextResponse.json({ message: "Informe o motivo / observações da baixa." }, { status: 400 });
  }

  const checkinAnswers = answers as Record<string, unknown>;
  const km = Number(checkinAnswers.km_atual);
  if (!Number.isSafeInteger(km) || km < 0) {
    return NextResponse.json({ message: "Informe um KM atual válido." }, { status: 400 });
  }

  const photos = preparePhotos(payload.photos);
  if (!photos) {
    return NextResponse.json(
      { message: "Uma das fotos não pôde ser processada. Remova-a e tente novamente." },
      { status: 400 },
    );
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
  if (!viatura) {
    return NextResponse.json({ message: "VTR não encontrada." }, { status: 404 });
  }
  if (typeof viatura.situacao !== "string" || viatura.situacao.trim().toLowerCase() !== "ativa") {
    return NextResponse.json({ message: "Esta VTR não está ativa e não pode ser baixada novamente." }, { status: 409 });
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
    if (
      typeof checkinAnswers[field] !== "string" ||
      !options.includes(checkinAnswers[field] as string)
    ) {
      return NextResponse.json(
        { message: "Preencha todos os campos obrigatórios da baixa." },
        { status: 400 },
      );
    }
  }
  if (typeof checkinAnswers.combustivel !== "string" || !fuelOptions.includes(checkinAnswers.combustivel)) {
    return NextResponse.json({ message: "Selecione uma opção válida de combustível." }, { status: 400 });
  }

  const combustivel = checkinAnswers.combustivel.toLowerCase();
  const oleoMotor = (checkinAnswers.oleo_motor as string).toLowerCase();
  const liquidoArrefecimento = (checkinAnswers.liquido_arrefecimento as string).toLowerCase();
  const checklist: Record<string, unknown> = {
    km_atual: km,
    combustivel,
    oleo_motor: oleoMotor,
    liquido_arrefecimento: liquidoArrefecimento,
    observacoes: motivo,
  };
  for (const field of Object.keys(requiredFields)) {
    if (field !== "oleo_motor" && field !== "liquido_arrefecimento") {
      checklist[field] = checkinAnswers[field];
    }
  }

  // O UUID é reservado em memória, mas nenhuma baixa existe no banco ainda.
  // As fotos são enviadas primeiro; somente depois uma única RPC grava
  // registro + metadados das fotos + situação da VTR atomicamente.
  const registroId = randomUUID();
  const attemptedPaths: string[] = [];

  try {
    for (const photo of photos) {
      const path = `${viatura.id}/${registroId}/${randomUUID()}.${photo.extension}`;
      attemptedPaths.push(path);

      const { error: uploadError } = await supabase.storage
        .from(photoBucket)
        .upload(path, photo.bytes, {
          contentType: photo.contentType,
          upsert: false,
        });

      if (uploadError) throw uploadError;
    }

    const { error: concluirError } = await supabase.rpc("concluir_baixa_vtr", {
      target_id: viatura.id,
      actor_id: user.id,
      novo_registro_id: registroId,
      km_atual: km,
      combustivel_valor: combustivel,
      oleo_valor: oleoMotor,
      arrefecimento_valor: liquidoArrefecimento,
      dados: checklist,
      motivo,
      caminhos_fotos: attemptedPaths,
    });

    if (concluirError) {
      if (concluirError.message === "KM_REGRESSION") {
        const { data: atual } = await supabase
          .from("viaturas")
          .select("quilometragem")
          .eq("id", viatura.id)
          .maybeSingle();

        if (atual && typeof atual.quilometragem === "number") {
          return NextResponse.json(
            { message: kmRegressionMessage(atual.quilometragem) },
            { status: 409 },
          );
        }
      }

      throw concluirError;
    }
  } catch (error) {
    // Se a RPC falhou, a transação PostgreSQL já foi revertida.
    // O rollback aqui serve principalmente para remover uploads temporários.
    const rollbackSucceeded = await rollbackVtrOperation({
      viaturaId: viatura.id,
      registroId,
      attemptedPaths,
    });

    console.error("Falha ao baixar VTR", { error, rollbackSucceeded });

    return NextResponse.json(
      {
        message: rollbackSucceeded
          ? "Não foi possível baixar a VTR. Nenhuma baixa foi registrada e os dados do formulário foram preservados."
          : "A baixa não foi registrada, mas a limpeza das fotos temporárias ficou incompleta. Os dados foram preservados; procure o suporte antes de tentar novamente.",
        ...errorFields(error),
      },
      { status: 500 },
    );
  }

  revalidatePath(`/protected/viaturas/${id}`);
  revalidatePath("/protected");
  return NextResponse.json({ message: "VTR baixada com sucesso." }, { status: 201 });
}
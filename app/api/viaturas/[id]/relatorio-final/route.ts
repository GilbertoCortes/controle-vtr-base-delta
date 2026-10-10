import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/supabase/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin-server";
import { fullHistoryFileName, generateFullHistoryPdf, type HistoryPdfEvent } from "@/lib/full-history-pdf";
import { validateInspectionAnswers, validateInspectionPhotos } from "@/lib/vtr-inspection";
import { readCompleteRows } from "@/lib/supabase/read-complete";

const failure = "Não foi possível gerar o relatório final. A VTR não foi excluída.";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireActiveSession();
  if (!session.ok) return session.response;
  if (!session.isAdmin) return NextResponse.json({ message: "Ação permitida somente para administradores." }, { status: 403 });
  const { id } = await params;
  try {
    const client = createSupabaseAdminClient();
    const { data: withdrawal, error: withdrawalError } = await client.from("retiradas_vtr")
      .select("registro_id, fase").eq("viatura_id", id).maybeSingle();
    if (withdrawalError || !withdrawal || !["pronta", "selada"].includes(withdrawal.fase)) throw new Error("Vistoria final indisponível ou com fotos ainda em envio.");
    const { error: sealError } = await client.rpc("selar_vistoria_final", { target_id: id });
    if (sealError) throw sealError;
    const { data: viatura, error: viaturaError } = await client.from("viaturas").select("id, placa, tipo").eq("id", id).single();
    if (viaturaError || !viatura || (viatura.tipo !== "Viatura" && viatura.tipo !== "Motocicleta")) throw new Error("Identificação da VTR indisponível.");
    const records = await readCompleteRows((from, to) => client.from("registros_vtr").select(
      "id, tipo_registro, criado_em, km, combustivel, oleo_motor, liquido_arrefecimento, checklist, usuario_id, reparos_realizados, descricao_reparos, empresa, responsavel_entrega, cpf_responsavel_entrega",
      { count: "exact" },
    ).eq("viatura_id", id).order("criado_em", { ascending: true }).order("id", { ascending: true }).range(from, to));
    if (!records.length) throw new Error("Histórico indisponível.");
    const final = records.find((r) => r.id === withdrawal.registro_id);
    if (!final || final.tipo_registro !== "vistoria_final" || validateInspectionAnswers(final.checklist, viatura.tipo)) throw new Error("Vistoria final incompleta.");
    const ordered = [...records.filter((r) => r.id !== final.id), final];
    if (ordered.some((r) => !r.tipo_registro || !r.criado_em || Number.isNaN(Date.parse(r.criado_em)))) throw new Error("Evento sem identificação essencial.");
    if (ordered.some((r) => Date.parse(r.criado_em) > Date.parse(final.criado_em))) throw new Error("A vistoria final não é o último evento cronológico.");
    const loadPhotos = (ids: string[]) => readCompleteRows((from, to) => client.from("fotos_registro_vtr")
      .select("registro_id, caminho_storage, descricao, categoria", { count: "exact" }).in("registro_id", ids)
      .order("criado_em").order("id").range(from, to));
    const photos = [];
    for (let index = 0; index < ordered.length; index += 100) {
      photos.push(...await loadPhotos(ordered.slice(index, index + 100).map((r) => r.id)));
    }
    if (validateInspectionPhotos(photos.filter((p) => p.registro_id === final.id))) throw new Error("Fotos da vistoria final incompletas.");
    const responsibleIds = [...new Set(ordered.map((r) => r.usuario_id).filter((uid): uid is string => typeof uid === "string"))];
    const profiles = [];
    for (let index = 0; index < responsibleIds.length; index += 100) {
      profiles.push(...await readCompleteRows((from, to) => client.from("profiles")
        .select("id, nome_completo, rg_id, base, ala", { count: "exact" }).in("id", responsibleIds.slice(index, index + 100))
        .order("id").range(from, to)));
    }
    const events: HistoryPdfEvent[] = [];
    for (const r of ordered) {
      const profile = profiles.find((p) => p.id === r.usuario_id) ?? null;
      const event: HistoryPdfEvent = {
        registro: {
          tipoRegistro: r.tipo_registro, criadoEm: r.criado_em, km: r.km,
          combustivel: r.combustivel, oleoMotor: r.oleo_motor, liquidoArrefecimento: r.liquido_arrefecimento,
          checklist: r.checklist, reparosRealizados: r.reparos_realizados, descricaoReparos: r.descricao_reparos,
          empresa: r.empresa, responsavelEntrega: r.responsavel_entrega, cpfResponsavelEntrega: r.cpf_responsavel_entrega,
          responsavel: profile?.nome_completo ?? null,
        },
        profile, fotos: [],
      };
      for (const p of photos.filter((photo) => photo.registro_id === r.id)) {
        if (typeof p.caminho_storage !== "string" || !p.caminho_storage.startsWith(`${id}/${r.id}/`)) throw new Error("Caminho de foto inconsistente.");
        const { data: blob, error: downloadError } = await client.storage.from("fotos-vtr").download(p.caminho_storage);
        if (downloadError || !blob) throw new Error("Não foi possível carregar todas as fotos.");
        event.fotos.push({ bytes: Buffer.from(await blob.arrayBuffer()), descricao: p.descricao, categoria: p.categoria });
      }
      events.push(event);
    }
    const pdf = await generateFullHistoryPdf(viatura, events);
    if (!pdf.length) throw new Error("PDF vazio.");
    const receipt = randomBytes(32).toString("hex");
    const { data: saved, error: receiptError } = await client.from("retiradas_vtr").update({
      administrador_id: session.user.id, recibo_hash: createHash("sha256").update(receipt).digest("hex"),
      pdf_hash: createHash("sha256").update(pdf).digest("hex"), pdf_bytes: pdf.length, relatorio_em: new Date().toISOString(),
    }).eq("viatura_id", id).eq("fase", "selada").select("viatura_id").maybeSingle();
    if (receiptError || !saved) throw new Error("Não foi possível registrar a geração do relatório.");
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${fullHistoryFileName(viatura.placa)}"`,
        "Content-Length": String(pdf.length), "Cache-Control": "no-store",
        "X-Relatorio-Bytes": String(pdf.length),
        "X-Relatorio-Recibo": receipt, "X-Relatorio-SHA256": createHash("sha256").update(pdf).digest("hex"),
      },
    });
  } catch (error) {
    console.error("Falha no relatório final completo", { id, error });
    return NextResponse.json({ message: failure }, { status: 500 });
  }
}

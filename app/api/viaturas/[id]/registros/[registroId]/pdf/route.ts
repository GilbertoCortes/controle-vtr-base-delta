import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/supabase/admin";
import {
  buildPdfFileName,
  generateRegistroPdf,
  type FotoPdfData,
  type RegistroPdfData,
} from "@/lib/registro-pdf";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; registroId: string }> },
) {
  const session = await requireActiveSession();
  if (!session.ok) return session.response;
  const { supabase } = session;

  const { id: viaturaId, registroId } = await params;

  // VTR existente
  const { data: viatura, error: viaturaError } = await supabase
    .from("viaturas")
    .select("id, placa, tipo")
    .eq("id", viaturaId)
    .maybeSingle();
  if (viaturaError) {
    return NextResponse.json({ message: "Não foi possível carregar a VTR." }, { status: 500 });
  }
  if (!viatura) {
    return NextResponse.json({ message: "VTR não encontrada." }, { status: 404 });
  }

  // Registro pertencente exatamente a esta VTR
  const { data: registro, error: registroError } = await supabase
    .from("registros_vtr")
    .select(
      "id, viatura_id, tipo_registro, km, combustivel, oleo_motor, liquido_arrefecimento, checklist, usuario_id, criado_em, reparos_realizados, descricao_reparos, empresa, responsavel_entrega, cpf_responsavel_entrega",
    )
    .eq("id", registroId)
    .eq("viatura_id", viatura.id)
    .maybeSingle();
  if (registroError) {
    return NextResponse.json({ message: "Não foi possível carregar o registro." }, { status: 500 });
  }
  if (!registro) {
    return NextResponse.json({ message: "Registro não encontrado." }, { status: 404 });
  }

  // Responsavel (nome)
  let responsavel: string | null = null;
  if (registro.usuario_id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("nome_completo")
      .eq("id", registro.usuario_id)
      .maybeSingle();
    responsavel = profile?.nome_completo ?? null;
  }

  // Fotos vinculadas - baixa no servidor; falha individual nao corrompe o PDF
  const { data: fotosData } = await supabase
    .from("fotos_registro_vtr")
    .select("caminho_storage, descricao")
    .eq("registro_id", registro.id)
    .order("criado_em", { ascending: true });

  const fotos: FotoPdfData[] = [];
  for (const foto of fotosData ?? []) {
    try {
      const { data: blob, error: downloadError } = await supabase.storage
        .from("fotos-vtr")
        .download(foto.caminho_storage);
      if (downloadError || !blob) continue; // pula foto que falhou, sem corromper
      const bytes = Buffer.from(await blob.arrayBuffer());
      if (bytes.length) fotos.push({ bytes, descricao: foto.descricao ?? null });
    } catch {
      continue; // falha individual: ignora a foto
    }
  }

  const registroPdf: RegistroPdfData = {
    tipoRegistro: registro.tipo_registro,
    criadoEm: registro.criado_em,
    km: registro.km,
    combustivel: registro.combustivel,
    oleoMotor: registro.oleo_motor,
    liquidoArrefecimento: registro.liquido_arrefecimento,
    checklist: registro.checklist ?? null,
    reparosRealizados: registro.reparos_realizados,
    descricaoReparos: registro.descricao_reparos,
    empresa: registro.empresa,
    responsavelEntrega: registro.responsavel_entrega,
    cpfResponsavelEntrega: registro.cpf_responsavel_entrega,
    responsavel,
  };

  const viaturaPdf = {
    placa: viatura.placa,
    tipo: viatura.tipo,
  };

  const pdf = await generateRegistroPdf(viaturaPdf, registroPdf, fotos);
  const fileName = buildPdfFileName(viaturaPdf, registroPdf);

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

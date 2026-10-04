import PDFDocument from "pdfkit";
import { formatPlate } from "@/lib/plate";

export type RegistroPdfData = {
  tipoRegistro: string;
  criadoEm: string;
  km: number | null;
  combustivel: string | null;
  oleoMotor: string | null;
  liquidoArrefecimento: string | null;
  checklist: Record<string, unknown> | null;
  reparosRealizados: boolean | null;
  descricaoReparos: string | null;
  empresa: string | null;
  responsavelEntrega: string | null;
  cpfResponsavelEntrega: string | null;
  responsavel: string | null; // nome_completo do usuario que registrou
};

export type ViaturaPdfData = {
  placa: string;
  tipo: string;
};

export type FotoPdfData = {
  bytes: Buffer;
  descricao: string | null;
};

const checklistLabels: Record<string, string> = {
  km_atual: "KM",
  combustivel: "Combustível",
  oleo_motor: "Óleo do motor",
  liquido_arrefecimento: "Líquido de arrefecimento",
  observacoes: "Observações",
  reparos_realizados: "Reparos realizados",
  descricao_reparos: "Descrição dos reparos",
  pneu_dianteiro_esquerdo: "Pneu dianteiro esquerdo",
  pneu_dianteiro_direito: "Pneu dianteiro direito",
  pneu_traseiro_esquerdo: "Pneu traseiro esquerdo",
  pneu_traseiro_direito: "Pneu traseiro direito",
  pneu_dianteiro: "Pneu dianteiro",
  pneu_traseiro: "Pneu traseiro",
  estepe: "Estepe",
  seta_dianteira_direita: "Seta dianteira direita",
  seta_dianteira_esquerda: "Seta dianteira esquerda",
  seta_traseira_direita: "Seta traseira direita",
  seta_traseira_esquerda: "Seta traseira esquerda",
  luz_freio: "Luz de freio",
  luz_alerta: "Luz de alerta",
  farol_alto: "Farol alto",
  farol_baixo: "Farol baixo",
  buzina: "Buzina",
  strobo: "Strobo",
  sirene: "Sirene",
  giroflex: "Giroflex",
  triangulo: "Triângulo",
  chave_roda: "Chave de roda",
  retrovisor_direito: "Retrovisor direito",
  retrovisor_esquerdo: "Retrovisor esquerdo",
};

function formatDate(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(d);
}
function formatTime(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" }).format(d);
}
function formatKm(value: number | null) {
  return value === null ? "—" : `${value.toLocaleString("pt-BR")} km`;
}
function display(value: unknown) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function tipoRegistroLabel(value: string) {
  if (value === "checkin_inicial") return "Check-in/Entrada de VTR";
  if (value === "baixa") return "Baixa";
  if (value === "recebimento") return "Recebimento da Oficina";
  if (value === "remocao_base") return "Removida da Base Delta";
  return value;
}

function sanitizeFilePart(value: string) {
  return value.replace(/[^A-Z0-9-]/gi, "").toUpperCase();
}

// Slug legivel por tipo de registro para o nome do arquivo.
function tipoSlug(value: string) {
  if (value === "checkin_inicial") return "CHECK-IN";
  if (value === "baixa") return "BAIXA";
  if (value === "recebimento") return "RECEBIMENTO";
  if (value === "remocao_base") return "REMOCAO";
  return sanitizeFilePart(value) || "REGISTRO";
}

export function buildPdfFileName(viatura: ViaturaPdfData, registro: RegistroPdfData) {
  const placa = sanitizeFilePart(formatPlate(viatura.placa));
  const tipo = tipoSlug(registro.tipoRegistro);
  const data = formatDate(registro.criadoEm).replace(/\//g, "-");
  return `VTR_${placa}_${tipo}_${data}.pdf`;
}

export async function generateRegistroPdf(
  viatura: ViaturaPdfData,
  registro: RegistroPdfData,
  fotos: FotoPdfData[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 50, bottom: 70, left: 50, right: 50 } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const geradoEm = new Date();
    const rodape = `Controle de VTR – Base Delta  ·  Documento gerado em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(geradoEm)} às ${new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" }).format(geradoEm)}`;

    // Rodape desenhado em posicao absoluta SEM disparar nova pagina:
    // remove temporariamente o listener pageAdded durante a escrita para que o
    // texto no rodape nao crie pagina em branco nem recursao.
    function drawFooter() {
      const contentY = doc.y;
      const contentX = doc.x;
      doc.removeListener("pageAdded", drawFooter);
      const bottom = doc.page.height - 45;
      doc.fontSize(8).fillColor("#666666").text(rodape, doc.page.margins.left, bottom, {
        width: pageWidth,
        height: 12,
        align: "center",
        lineBreak: false,
        ellipsis: true,
      });
      doc.x = contentX;
      doc.y = contentY;
      doc.on("pageAdded", drawFooter);
    }
    doc.on("pageAdded", drawFooter);

    // Cabecalho
    doc.fontSize(16).fillColor("#111111").text("CONTROLE DE VTR – BASE DELTA", { align: "center" });
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor("#444444").text("Relatório Operacional de Registro", { align: "center" });
    doc.moveDown(1);

    function section(title: string) {
      doc.moveDown(0.6);
      doc.fontSize(12).fillColor("#111111").text(title, { underline: false });
      doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + pageWidth, doc.y).strokeColor("#cccccc").stroke();
      doc.moveDown(0.4);
    }
    function field(label: string, value: string) {
      doc.fontSize(9).fillColor("#666666").text(label);
      doc.fontSize(11).fillColor("#111111").text(value);
      doc.moveDown(0.3);
    }

    // Identificacao da VTR
    section("Identificação da VTR");
    field("Placa", formatPlate(viatura.placa));
    field("Tipo da VTR", display(viatura.tipo));

    // Identificacao do evento
    section("Identificação do Evento");
    field("Tipo do registro", tipoRegistroLabel(registro.tipoRegistro));
    field("Data", formatDate(registro.criadoEm));
    field("Hora", formatTime(registro.criadoEm));
    field("KM", formatKm(registro.km));

    // Dados operacionais comuns
    const checklist = registro.checklist ?? {};
    const observacoes = checklist.observacoes;
    section("Dados Operacionais");
    field("Combustível", display(registro.combustivel ?? checklist.combustivel));
    field("Óleo do motor", display(registro.oleoMotor ?? checklist.oleo_motor));
    field("Líquido de arrefecimento", display(registro.liquidoArrefecimento ?? checklist.liquido_arrefecimento));

    // Campos especificos do recebimento
    if (registro.tipoRegistro === "recebimento") {
      field("Empresa", display(registro.empresa));
      field("Responsável pela entrega", display(registro.responsavelEntrega));
      field("CPF do responsável", display(registro.cpfResponsavelEntrega));
      field("Reparos realizados", registro.reparosRealizados === null ? "—" : registro.reparosRealizados ? "Sim" : "Não");
      if (registro.descricaoReparos) field("Descrição dos reparos", display(registro.descricaoReparos));
    }

    // Observacoes / motivo
    if (observacoes !== undefined && observacoes !== null && observacoes !== "") {
      field(registro.tipoRegistro === "baixa" ? "Motivo / observações" : "Observações", display(observacoes));
    }

    // Checklist completo
    const checklistItems = Object.entries(checklist).filter(([k]) => k !== "observacoes");
    if (checklistItems.length) {
      section("Checklist");
      for (const [key, value] of checklistItems) {
        field(checklistLabels[key] ?? key.replaceAll("_", " "), display(value));
      }
    }

    // Responsavel
    if (registro.responsavel) {
      section("Responsável");
      field("Registrado por", display(registro.responsavel));
    }

    // Fotos (somente se houver)
    const fotosOk = fotos.filter((f) => f.bytes && f.bytes.length);
    if (fotosOk.length) {
      section("Fotos");
      const maxImgWidth = pageWidth;
      const maxImgHeight = 320;
      fotosOk.forEach((foto, index) => {
        try {
          if (doc.y + maxImgHeight > doc.page.height - doc.page.margins.bottom - 20) {
            doc.addPage();
          }
          doc.image(foto.bytes, {
            fit: [maxImgWidth, maxImgHeight],
            align: "center",
          });
          if (foto.descricao) {
            doc.fontSize(8).fillColor("#666666").text(foto.descricao, { align: "center" });
          }
          // Espaco entre fotos, mas nao apos a ultima (evita pagina em branco final).
          if (index < fotosOk.length - 1) doc.moveDown(0.6);
        } catch {
          doc.fontSize(9).fillColor("#999999").text("(Não foi possível incluir uma foto.)");
          if (index < fotosOk.length - 1) doc.moveDown(0.4);
        }
      });
    }

    drawFooter();
    doc.end();
  });
}

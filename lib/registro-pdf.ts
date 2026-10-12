import PDFDocument from "pdfkit";
import { formatPlate } from "@/lib/plate";

export const vtrPdfColors = {
  navy: "#172B40",
  text: "#1B3046",
  muted: "#53667A",
  stripe: "#EEF2F6",
  line: "#DCE4EB",
};

export type RegistroPdfData = {
  tipoRegistro: string;
  atividadeNumero: number | null;
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
  categoria?: string | null;
};

export function fotoCategoriaTitulo(categoria?: string | null) {
  const titulos: Record<string, string> = {
    frente: "FRONTAL",
    lateral_direita: "LATERAL DIREITA",
    lateral_esquerda: "LATERAL ESQUERDA",
    traseira: "TRASEIRA",
    painel: "PAINEL",
    equipamentos: "ESTEPE / CHAVE DE RODA / MACACO / TRIÂNGULO",
    avarias: "AVARIAS",
  };

  return categoria ? titulos[categoria] ?? categoria.replaceAll("_", " ").toUpperCase() : "FOTO";
}

const checklistLabels: Record<string, string> = {
  pintura: "Pintura",
  lataria: "Lataria",
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
  if (value === "vistoria_final") return "Vistoria Final de Retirada";
  if (value === "remocao_base") return "Removida da Base Delta";
  return value;
}

export function drawVtrPdfHeader(doc: PDFKit.PDFDocument, title: string, subtitle: string) {
  const x = doc.page.margins.left;
  const width = doc.page.width - x - doc.page.margins.right;
  doc.font("Helvetica").fontSize(8).fillColor(vtrPdfColors.muted)
    .text("SEGURANÇA PRESENTE | BASE DELTA", x, doc.y, { width, align: "center" });
  doc.moveDown(0.55);
  doc.font("Helvetica-Bold").fontSize(17).fillColor(vtrPdfColors.navy)
    .text(title.toUpperCase(), x, doc.y, { width, align: "center" });
  doc.moveDown(0.35);
  doc.font("Helvetica").fontSize(9).fillColor(vtrPdfColors.muted)
    .text(subtitle, x, doc.y, { width, align: "center" });
  doc.moveDown(1.4);
}

export function drawVtrPdfSection(doc: PDFKit.PDFDocument, title: string) {
  if (doc.y > doc.page.height - 115) doc.addPage();
  const x = doc.page.margins.left;
  const width = doc.page.width - x - doc.page.margins.right;
  doc.moveDown(0.55);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(vtrPdfColors.navy).text(title.toUpperCase(), x, doc.y, { width });
  doc.moveDown(0.65);
}

export function drawVtrPdfRow(doc: PDFKit.PDFDocument, label: string, value: string, striped: boolean) {
  const x = doc.page.margins.left;
  const width = doc.page.width - x - doc.page.margins.right;
  const labelWidth = Math.round(width * 0.32);
  const valueWidth = width - labelWidth - 28;
  doc.font("Helvetica").fontSize(9);
  const labelHeight = doc.heightOfString(label, { width: labelWidth - 16 });
  const valueHeight = doc.heightOfString(value, { width: valueWidth });
  const height = Math.max(24, Math.ceil(Math.max(labelHeight, valueHeight)) + 10);
  if (doc.y + height > doc.page.height - 75) doc.addPage();
  const y = doc.y;
  if (striped) doc.rect(x, y, width, height).fill(vtrPdfColors.stripe);
  doc.font("Helvetica").fontSize(9).fillColor(vtrPdfColors.text)
    .text(label, x + 9, y + 6, { width: labelWidth - 16 });
  doc.text(value, x + labelWidth + 9, y + 6, { width: valueWidth });
  doc.y = y + height;
  doc.x = x;
}

function sanitizeFilePart(value: string) {
  return value.replace(/[^A-Z0-9-]/gi, "").toUpperCase();
}

// Slug legivel por tipo de registro para o nome do arquivo.
function tipoSlug(value: string) {
  if (value === "checkin_inicial") return "CHECK-IN";
  if (value === "baixa") return "BAIXA";
  if (value === "recebimento") return "RECEBIMENTO";
  if (value === "vistoria_final") return "VISTORIA-FINAL";
  if (value === "remocao_base") return "REMOCAO";
  return sanitizeFilePart(value) || "REGISTRO";
}

export function buildPdfFileName(viatura: ViaturaPdfData, registro: RegistroPdfData) {
  const placa = sanitizeFilePart(formatPlate(viatura.placa));
  const tipo = tipoSlug(registro.tipoRegistro);
  const data = formatDate(registro.criadoEm).replace(/\//g, "-");
  const atividade =
    registro.atividadeNumero !== null &&
    (registro.tipoRegistro === "baixa" || registro.tipoRegistro === "recebimento")
      ? `_ATIVIDADE_${registro.atividadeNumero}`
      : "";
  return `VTR_${placa}${atividade}_${tipo}_${data}.pdf`;
}

export async function generateRegistroPdf(
  viatura: ViaturaPdfData,
  registro: RegistroPdfData,
  fotos: FotoPdfData[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", bufferPages: true, margins: { top: 45, bottom: 65, left: 46, right: 46 } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const geradoEm = new Date();
    const rodape = `SEGURANÇA PRESENTE | BASE DELTA  ·  Gerado em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(geradoEm)} às ${new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" }).format(geradoEm)}`;

    function drawFooter(pageNumber: number, totalPages: number) {
      const contentY = doc.y;
      const contentX = doc.x;
      const bottom = doc.page.height - 45;
      doc.moveTo(doc.page.margins.left, bottom - 10).lineTo(doc.page.margins.left + pageWidth, bottom - 10).strokeColor(vtrPdfColors.line).stroke();
      doc.font("Helvetica").fontSize(7).fillColor(vtrPdfColors.muted).text(rodape, doc.page.margins.left, bottom, {
        width: pageWidth - 55,
        height: 12,
        align: "left",
        lineBreak: false,
        ellipsis: true,
      });
      doc.text(`Página ${pageNumber} / ${totalPages}`, doc.page.margins.left + pageWidth - 55, bottom, {
        width: 55, height: 12, align: "right", lineBreak: false,
      });
      doc.x = contentX;
      doc.y = contentY;
    }

    const reportTitle = registro.tipoRegistro === "checkin_inicial" ? "RELATÓRIO DE CHECK-IN INICIAL"
      : registro.tipoRegistro === "vistoria_final" ? "RELATÓRIO DE VISTORIA FINAL"
      : `RELATÓRIO DE ${tipoRegistroLabel(registro.tipoRegistro).toUpperCase()}`;
    drawVtrPdfHeader(doc, reportTitle, `VIATURA · PLACA ${formatPlate(viatura.placa)}`);
    let rowIndex = 0;

    function section(title: string) {
      drawVtrPdfSection(doc, title);
      rowIndex = 0;
    }
    function field(label: string, value: string) {
      drawVtrPdfRow(doc, label, value, rowIndex % 2 === 1);
      rowIndex += 1;
    }

    // Identificacao da VTR
    section("1. Identificação da VTR");
    field("Placa", formatPlate(viatura.placa));
    field("Tipo da VTR", display(viatura.tipo));

    // Identificacao do evento
    section("2. Identificação do Evento");
    if (
      registro.atividadeNumero !== null &&
      (registro.tipoRegistro === "baixa" || registro.tipoRegistro === "recebimento")
    ) {
      field("Atividade", String(registro.atividadeNumero));
    }
    field("Tipo do registro", tipoRegistroLabel(registro.tipoRegistro));
    field("Data", formatDate(registro.criadoEm));
    field("Hora", formatTime(registro.criadoEm));
    field("KM", formatKm(registro.km));

    // Dados operacionais comuns
    const checklist = registro.checklist ?? {};
    const observacoes = checklist.observacoes;
    section("3. Dados Operacionais");
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
      section("4. Checklist");
      for (const [key, value] of checklistItems) {
        field(checklistLabels[key] ?? key.replaceAll("_", " "), display(value));
      }
    }

    // Responsavel
    if (registro.responsavel) {
      section("5. Responsável");
      field("Registrado por", display(registro.responsavel));
    }

    // Fotos: categorias obrigatórias em página própria.
    // Avarias ficam agrupadas em uma seção própria.
    const fotosOk = fotos.filter((f) => f.bytes && f.bytes.length);
    if (fotosOk.length) {
      const fotosNormais = fotosOk.filter((foto) => foto.categoria !== "avarias");
      const fotosAvarias = fotosOk.filter((foto) => foto.categoria === "avarias");

      for (const foto of fotosNormais) {
        doc.addPage();
        drawVtrPdfHeader(doc, reportTitle, `VIATURA · PLACA ${formatPlate(viatura.placa)}`);
        doc
          .font("Helvetica-Bold")
          .fontSize(12)
          .fillColor(vtrPdfColors.navy)
          .text(fotoCategoriaTitulo(foto.categoria), {
            align: "center",
          });

        doc.moveDown(0.7);

        if (foto.descricao) {
          doc
            .font("Helvetica")
            .fontSize(9)
            .fillColor(vtrPdfColors.muted)
            .text(foto.descricao, { align: "center" });

          doc.moveDown(0.8);
        }

        const availableHeight =
          doc.page.height -
          doc.page.margins.bottom -
          doc.y -
          15;

        doc.image(foto.bytes, doc.page.margins.left, doc.y, {
          fit: [pageWidth, availableHeight],
          align: "center",
          valign: "center",
        });
      }

      if (fotosAvarias.length) {
        doc.addPage();
        drawVtrPdfHeader(doc, reportTitle, `VIATURA · PLACA ${formatPlate(viatura.placa)}`);
        doc
          .font("Helvetica-Bold")
          .fontSize(12)
          .fillColor(vtrPdfColors.navy)
          .text("AVARIAS", { align: "center" });

        doc.moveDown(0.7);

        for (const [index, foto] of fotosAvarias.entries()) {
          const maxImgHeight = 300;

          if (
            doc.y + maxImgHeight >
            doc.page.height - doc.page.margins.bottom
          ) {
            doc.addPage();
            drawVtrPdfHeader(doc, reportTitle, `VIATURA · PLACA ${formatPlate(viatura.placa)}`);
            doc
              .font("Helvetica-Bold")
              .fontSize(12)
              .fillColor(vtrPdfColors.navy)
              .text("AVARIAS", { align: "center" });

            doc.moveDown(0.7);
          }

          if (foto.descricao) {
            doc
              .font("Helvetica")
              .fontSize(9)
                .fillColor(vtrPdfColors.muted)
              .text(foto.descricao, { align: "center" });

            doc.moveDown(0.5);
          }

          doc.image(foto.bytes, {
            fit: [pageWidth, maxImgHeight],
            align: "center",
          });

          if (index < fotosAvarias.length - 1) {
            doc.moveDown(1);
          }
        }
      }
    }

    const pages = doc.bufferedPageRange();
    for (let page = pages.start; page < pages.start + pages.count; page += 1) {
      doc.switchToPage(page);
      drawFooter(page - pages.start + 1, pages.count);
    }
    doc.end();
  });
}

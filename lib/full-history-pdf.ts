import PDFDocument from "pdfkit";
import { formatPlate } from "@/lib/plate";
import {
  fotoCategoriaTitulo,
  drawVtrPdfHeader,
  drawVtrPdfRow,
  drawVtrPdfSection,
  vtrPdfColors,
  type FotoPdfData,
  type RegistroPdfData,
  type ViaturaPdfData,
} from "@/lib/registro-pdf";

export type HistoryPdfEvent = {
  registro: RegistroPdfData;
  fotos: (FotoPdfData & { categoria: string | null })[];
  profile: { rg_id: string | null; base: string | null; ala: string | null } | null;
};

export function fullHistoryFileName(placa: string) {
  return `HISTORICO_COMPLETO_${placa.replace(/[^A-Z0-9]/gi, "").toUpperCase()}.pdf`;
}

const labels: Record<string, string> = {
  checkin_inicial: "Check-in inicial", baixa: "Baixa", recebimento: "Recebimento da oficina",
  vistoria_final: "Vistoria Final de Retirada", pintura: "Pintura", lataria: "Lataria",
  combustivel: "Combustível", oleo_motor: "Óleo do motor", liquido_arrefecimento: "Líquido de arrefecimento",
  km_atual: "KM", observacoes: "Observações",
};

export async function generateFullHistoryPdf(viatura: ViaturaPdfData, events: HistoryPdfEvent[]): Promise<Buffer> {
  if (!events.length || events.at(-1)?.registro.tipoRegistro !== "vistoria_final") throw new Error("Vistoria final ausente do relatório.");
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", bufferPages: true, margins: { top: 45, bottom: 65, left: 46, right: 46 } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      let rowIndex = 0;
      const field = (label: string, value: unknown) => {
        drawVtrPdfRow(doc, label, String(value ?? "Não informado"), rowIndex % 2 === 1);
        rowIndex += 1;
      };
      const footer = (pageNumber: number, totalPages: number) => {
        const savedY = doc.y;
        const savedX = doc.x;
        const x = doc.page.margins.left;
        const width = doc.page.width - x - doc.page.margins.right;
        const y = doc.page.height - 48;
        doc.moveTo(x, y - 10).lineTo(x + width, y - 10).strokeColor(vtrPdfColors.line).stroke();
        doc.font("Helvetica").fontSize(7).fillColor(vtrPdfColors.muted)
          .text("SEGURANÇA PRESENTE | BASE DELTA", x, y, { width: width - 55, height: 10, lineBreak: false });
        doc.text(`Página ${pageNumber} / ${totalPages}`, x + width - 55, y, {
          width: 55, height: 10, align: "right", lineBreak: false,
        });
        doc.x = savedX;
        doc.y = savedY;
      };
      drawVtrPdfHeader(doc, "HISTÓRICO COMPLETO DA VTR", `VIATURA · PLACA ${formatPlate(viatura.placa)}`);
      drawVtrPdfSection(doc, "1. Resumo geral");
      field("Placa", formatPlate(viatura.placa));
      field("Tipo", viatura.tipo);
      field("Gerado em", new Date().toLocaleString("pt-BR"));
      field("Eventos", events.length);
      for (const [index, event] of events.entries()) {
        const r = event.registro;
        doc.addPage();
        drawVtrPdfHeader(doc, "HISTÓRICO COMPLETO DA VTR", `VIATURA · PLACA ${formatPlate(viatura.placa)}`);
        const eventLabel = labels[r.tipoRegistro] ?? r.tipoRegistro;
        const atividadeLabel =
          r.atividadeNumero !== null &&
          (r.tipoRegistro === "baixa" || r.tipoRegistro === "recebimento")
            ? `ATIVIDADE ${r.atividadeNumero} — `
            : "";
        drawVtrPdfSection(doc, `${index + 2}. ${atividadeLabel}${eventLabel}`);
        rowIndex = 0;
        field("Data/hora", new Date(r.criadoEm).toLocaleString("pt-BR"));
        field("KM", r.km);
        field("Responsável", r.responsavel);
        if (event.profile) {
          field("RG / ID", event.profile.rg_id);
          field("Base", event.profile.base);
          field("ALA", event.profile.ala);
        }
        field("Combustível", r.combustivel);
        field("Óleo do motor", r.oleoMotor);
        field("Arrefecimento", r.liquidoArrefecimento);
        if (r.tipoRegistro === "recebimento") {
          field("Empresa", r.empresa);
          field("Responsável pela entrega", r.responsavelEntrega);
          field("CPF", r.cpfResponsavelEntrega);
          field("Reparos realizados", r.reparosRealizados === null ? null : r.reparosRealizados ? "Sim" : "Não");
          field("Descrição dos reparos", r.descricaoReparos);
        }
        for (const [key, value] of Object.entries(r.checklist ?? {})) {
          field(labels[key] ?? key.replaceAll("_", " "), value);
        }
        const fotosNormais = event.fotos.filter((photo) => photo.categoria !== "avarias");
        const fotosAvarias = event.fotos.filter((photo) => photo.categoria === "avarias");

        for (const photo of fotosNormais) {
          if (!photo.bytes.length) {
            throw new Error("Foto vazia no relatório.");
          }

          doc.addPage();
          drawVtrPdfHeader(doc, "HISTÓRICO COMPLETO DA VTR", `VIATURA · PLACA ${formatPlate(viatura.placa)}`);

          doc
            .font("Helvetica-Bold")
            .fontSize(12)
            .fillColor(vtrPdfColors.navy)
            .text(fotoCategoriaTitulo(photo.categoria), {
              align: "center",
            });

          doc.moveDown(0.7);

          if (photo.descricao) {
            doc
              .font("Helvetica")
              .fontSize(9)
              .fillColor(vtrPdfColors.muted)
              .text(photo.descricao, { align: "center" });

            doc.moveDown(0.8);
          }

          const availableHeight =
            doc.page.height -
            doc.page.margins.bottom -
            doc.y -
            15;

          doc.image(photo.bytes, doc.page.margins.left, doc.y, {
            fit: [
              doc.page.width -
                doc.page.margins.left -
                doc.page.margins.right,
              availableHeight,
            ],
            align: "center",
            valign: "center",
          });
        }

        if (fotosAvarias.length) {
          doc.addPage();
          drawVtrPdfHeader(doc, "HISTÓRICO COMPLETO DA VTR", `VIATURA · PLACA ${formatPlate(viatura.placa)}`);

          doc
            .font("Helvetica-Bold")
            .fontSize(12)
            .fillColor(vtrPdfColors.navy)
            .text("AVARIAS", { align: "center" });

          doc.moveDown(0.7);

          for (const [photoIndex, photo] of fotosAvarias.entries()) {
            if (!photo.bytes.length) {
              throw new Error("Foto vazia no relatório.");
            }

            const maxImgHeight = 300;

            if (
              doc.y + maxImgHeight >
              doc.page.height - doc.page.margins.bottom
            ) {
              doc.addPage();
              drawVtrPdfHeader(doc, "HISTÓRICO COMPLETO DA VTR", `VIATURA · PLACA ${formatPlate(viatura.placa)}`);

              doc
                .font("Helvetica-Bold")
                .fontSize(12)
                .fillColor(vtrPdfColors.navy)
                .text("AVARIAS", { align: "center" });

              doc.moveDown(0.7);
            }

            if (photo.descricao) {
              doc
                .font("Helvetica")
                .fontSize(9)
                .fillColor(vtrPdfColors.muted)
                .text(photo.descricao, { align: "center" });

              doc.moveDown(0.5);
            }

            doc.image(photo.bytes, {
              fit: [
                doc.page.width -
                  doc.page.margins.left -
                  doc.page.margins.right,
                maxImgHeight,
              ],
              align: "center",
            });

            if (photoIndex < fotosAvarias.length - 1) {
              doc.moveDown(1);
            }
          }
        }
      }
      const pages = doc.bufferedPageRange();
      for (let page = pages.start; page < pages.start + pages.count; page += 1) {
        doc.switchToPage(page);
        footer(page - pages.start + 1, pages.count);
      }
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
}

import PDFDocument from "pdfkit";
import {
  fotoCategoriaTitulo,
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
    const doc = new PDFDocument({ size: "A4", margins: { top: 45, bottom: 55, left: 45, right: 45 } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      const field = (label: string, value: unknown) => {
        doc.font("Helvetica").fontSize(10).fillColor("#111111").text(`${label}: ${value ?? "Não informado"}`);
        doc.moveDown(0.3);
      };
      doc.font("Helvetica-Bold").fontSize(17).text("CONTROLE DE VTR - BASE DELTA", { align: "center" });
      doc.moveDown();
      doc.fontSize(14).text("HISTÓRICO COMPLETO DA VTR", { align: "center" });
      doc.moveDown();
      field("Placa", viatura.placa);
      field("Tipo", viatura.tipo);
      field("Gerado em", new Date().toLocaleString("pt-BR"));
      field("Eventos", events.length);
      for (const [index, event] of events.entries()) {
        const r = event.registro;
        doc.addPage();
        const eventLabel = labels[r.tipoRegistro] ?? r.tipoRegistro;
        const atividadeLabel =
          r.atividadeNumero !== null &&
          (r.tipoRegistro === "baixa" || r.tipoRegistro === "recebimento")
            ? `ATIVIDADE ${r.atividadeNumero} — `
            : "";
        doc.font("Helvetica-Bold").fontSize(14).text(
          `${index + 1}. ${atividadeLabel}${eventLabel}`,
        );
        doc.moveDown();
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

          doc
            .font("Helvetica-Bold")
            .fontSize(18)
            .fillColor("#111111")
            .text(fotoCategoriaTitulo(photo.categoria), {
              align: "center",
            });

          doc.moveDown(1);

          if (photo.descricao) {
            doc
              .font("Helvetica")
              .fontSize(9)
              .fillColor("#666666")
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

          doc
            .font("Helvetica-Bold")
            .fontSize(18)
            .fillColor("#111111")
            .text("AVARIAS", { align: "center" });

          doc.moveDown(1);

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

              doc
                .font("Helvetica-Bold")
                .fontSize(18)
                .fillColor("#111111")
                .text("AVARIAS", { align: "center" });

              doc.moveDown(1);
            }

            if (photo.descricao) {
              doc
                .font("Helvetica")
                .fontSize(9)
                .fillColor("#666666")
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
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
}

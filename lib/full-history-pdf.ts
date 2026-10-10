import PDFDocument from "pdfkit";
import { inspectionCategories } from "@/lib/vtr-inspection";
import type { FotoPdfData, RegistroPdfData, ViaturaPdfData } from "@/lib/registro-pdf";

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
        doc.font("Helvetica-Bold").fontSize(14).text(`${index + 1}. ${labels[r.tipoRegistro] ?? r.tipoRegistro}`);
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
        for (const [photoIndex, photo] of event.fotos.entries()) {
          if (!photo.bytes.length) throw new Error("Foto vazia no relatório.");
          doc.addPage();
          doc.font("Helvetica-Bold").fontSize(12).text(
            `${labels[r.tipoRegistro] ?? r.tipoRegistro} - Foto ${photoIndex + 1}`,
          );
          const category = inspectionCategories.find((item) => item.value === photo.categoria)?.label;
          field("Categoria", category ?? photo.categoria ?? "Foto histórica sem categoria");
          if (photo.descricao) field("Descrição", photo.descricao);
          // Uma imagem invalida invalida todo o relatorio, sem omitir fotos.
          if (doc.y > doc.page.height - doc.page.margins.bottom - 200) doc.addPage();
          const availableHeight = Math.min(560, doc.page.height - doc.page.margins.bottom - doc.y - 10);
          doc.image(photo.bytes, 45, doc.y + 10, { fit: [doc.page.width - 90, availableHeight] });
        }
      }
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
}

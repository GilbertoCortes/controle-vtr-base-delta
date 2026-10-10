"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { InitialCheckinForm } from "@/components/initial-checkin-form";
import type { ViaturaDraft } from "@/lib/vtr-draft";
import { finalReportFailure, initiateFinalReportDownload, receiveFinalReport } from "@/lib/final-report-download";

export function FinalWithdrawal({ viatura, hasFinal }: {
  viatura: ViaturaDraft & { id: string }; hasFinal: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(hasFinal);
  const [report, setReport] = useState<{ blob: Blob; receipt: string } | null>(null);
  const [downloadStarted, setDownloadStarted] = useState(false);
  const [confirmedSaved, setConfirmedSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buttonClass = "min-h-12 w-full rounded-md bg-[#d5b45b] px-4 py-3 text-sm font-bold text-[#17201e] disabled:opacity-50";

  async function generateReport() {
    if (busy) return;
    setBusy(true); setError(null); setReport(null); setDownloadStarted(false); setConfirmedSaved(false);
    try {
      const response = await fetch(`/api/viaturas/${viatura.id}/relatorio-final`, { cache: "no-store" });
      setReport(await receiveFinalReport(response));
    } catch (error) {
      console.error("Falha ao receber relatório final", error);
      setError(finalReportFailure);
    } finally { setBusy(false); }
  }
  async function downloadReport() {
    if (!report || busy) return;
    setBusy(true); setError(null); setDownloadStarted(false); setConfirmedSaved(false);
    try {
      await initiateFinalReportDownload(report.blob, `HISTORICO_COMPLETO_${viatura.placa.replace(/[^A-Z0-9]/gi, "")}.pdf`);
      setDownloadStarted(true);
    } catch (error) {
      console.error("Download final cancelado ou bloqueado", error);
      setError(finalReportFailure);
    } finally { setBusy(false); }
  }
  async function confirmDelete() {
    if (busy || !report || !downloadStarted || !confirmedSaved) return;
    if (!window.confirm("Esta ação excluirá permanentemente esta VTR, todo o seu histórico e todas as fotos vinculadas. Esta ação não poderá ser desfeita.")) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/viaturas/${viatura.id}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmacao: "EXCLUIR DEFINITIVAMENTE", recibo: report.receipt, pdfSalvo: true }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(typeof result.message === "string" ? result.message : "Não foi possível concluir a exclusão.");
      }
      router.replace("/protected"); router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Não foi possível concluir a exclusão.");
    } finally { setBusy(false); }
  }
  return (
    <div className="space-y-6">
      <p className="rounded-md border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
        A VTR somente será apagada depois da vistoria, do relatório completo e da sua confirmação de que salvou o PDF.
        Enquanto a retirada estiver em andamento, novas alterações desta VTR ficarão bloqueadas.
      </p>
      {!saved ? <InitialCheckinForm finalViatura={viatura} onFinalSaved={() => setSaved(true)} /> : (
        <div className="space-y-4 rounded-lg border border-white/10 bg-[#192222] p-5">
          <p className="text-sm text-[#e0e8e3]">Vistoria final salva. Gere e salve o arquivo antes de confirmar a exclusão.</p>
          <button type="button" disabled={busy || downloadStarted} onClick={() => void generateReport()} className={buttonClass}>
            {busy ? "AGUARDE..." : "GERAR PDF COMPLETO"}
          </button>
          {report && <button type="button" disabled={busy} onClick={() => void downloadReport()} className={buttonClass}>BAIXAR / SALVAR PDF COMPLETO</button>}
          {downloadStarted && (
            <label className="flex min-h-12 items-center gap-3 text-sm text-[#e0e8e3]">
              <input type="checkbox" checked={confirmedSaved} onChange={(event) => setConfirmedSaved(event.target.checked)} />
              Salvei o PDF completo e verifiquei que consigo abri-lo.
            </label>
          )}
          <button type="button" disabled={busy || !report || !downloadStarted || !confirmedSaved}
            onClick={() => void confirmDelete()} className="min-h-12 w-full rounded-md bg-[#bd4c4b] px-4 text-sm font-bold text-white disabled:opacity-50">
            CONFIRMAR EXCLUSÃO DEFINITIVA
          </button>
          <p className="text-xs text-[#a9b8b1]">Se o celular bloquear o download, cancele. Sem sua confirmação, os dados são preservados.</p>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-[#f0aaa2]">{error}</p>}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { InitialCheckinForm } from "@/components/initial-checkin-form";
import type { ViaturaDraft } from "@/lib/vtr-draft";
import { finalReportFailure, initiateFinalReportDownload, receiveFinalReport } from "@/lib/final-report-download";

export function FinalWithdrawal({ viatura, withdrawal }: {
  viatura: ViaturaDraft & { id: string };
  withdrawal: { registroId: string; fase: string } | null;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(withdrawal?.fase === "pronta" || withdrawal?.fase === "selada");
  const [registroId, setRegistroId] = useState<string | null>(withdrawal?.registroId ?? null);
  const [report, setReport] = useState<{ blob: Blob; receipt: string } | null>(null);
  const [downloadStarted, setDownloadStarted] = useState(false);
  const [confirmedSaved, setConfirmedSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lifecycleRef = useRef(0);

  function finalSaved(id: string) {
    setRegistroId(id);
    setSaved(true);
    router.refresh();
  }

  useEffect(() => {
    function invalidateLocalReport() {
      lifecycleRef.current += 1;
      setReport(null);
      setDownloadStarted(false);
      setConfirmedSaved(false);
      setBusy(false);
      setError(null);
    }
    function restore(event: PageTransitionEvent) {
      if (event.persisted) router.refresh();
    }
    window.addEventListener("pagehide", invalidateLocalReport);
    window.addEventListener("pageshow", restore);
    return () => {
      lifecycleRef.current += 1;
      window.removeEventListener("pagehide", invalidateLocalReport);
      window.removeEventListener("pageshow", restore);
    };
  }, [router]);
  const buttonClass = "min-h-12 w-full rounded-md bg-[#d5b45b] px-4 py-3 text-sm font-bold text-[#17201e] disabled:opacity-50";

  async function generateReport() {
    if (busy) return;
    const lifecycle = lifecycleRef.current;
    setBusy(true); setError(null); setReport(null); setDownloadStarted(false); setConfirmedSaved(false);
    try {
      const response = await fetch(`/api/viaturas/${viatura.id}/relatorio-final`, { cache: "no-store" });
      const received = await receiveFinalReport(response);
      if (lifecycle !== lifecycleRef.current) return;
      setReport(received);
    } catch (error) {
      if (lifecycle !== lifecycleRef.current) return;
      console.error("Falha ao receber relatório final", error);
      setError(finalReportFailure);
    } finally { if (lifecycle === lifecycleRef.current) setBusy(false); }
  }
  async function downloadReport() {
    if (!report || busy) return;
    const lifecycle = lifecycleRef.current;
    setBusy(true); setError(null); setDownloadStarted(false); setConfirmedSaved(false);
    try {
      await initiateFinalReportDownload(report.blob, `HISTORICO_COMPLETO_${viatura.placa.replace(/[^A-Z0-9]/gi, "")}.pdf`);
      if (lifecycle !== lifecycleRef.current) return;
      setDownloadStarted(true);
    } catch (error) {
      if (lifecycle !== lifecycleRef.current) return;
      console.error("Download final cancelado ou bloqueado", error);
      setError(finalReportFailure);
    } finally { if (lifecycle === lifecycleRef.current) setBusy(false); }
  }
  async function confirmDelete() {
    if (busy || !report || !downloadStarted || !confirmedSaved) return;
    if (!window.confirm("Esta ação excluirá permanentemente esta VTR, todo o seu histórico e todas as fotos vinculadas. Esta ação não poderá ser desfeita.")) return;
    const lifecycle = lifecycleRef.current;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/viaturas/${viatura.id}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmacao: "EXCLUIR DEFINITIVAMENTE", recibo: report.receipt, pdfSalvo: true }),
      });
      if (lifecycle !== lifecycleRef.current) return;
      if (!response.ok) {
        const result = await response.json();
        throw new Error(typeof result.message === "string" ? result.message : "Não foi possível concluir a exclusão.");
      }
      router.replace("/protected"); router.refresh();
    } catch (error) {
      if (lifecycle !== lifecycleRef.current) return;
      setError(error instanceof Error ? error.message : "Não foi possível concluir a exclusão.");
    } finally { if (lifecycle === lifecycleRef.current) setBusy(false); }
  }

  async function cancelWithdrawal() {
    if (busy || !registroId || withdrawal?.fase === "autorizada") return;
    if (!window.confirm("Cancelar esta retirada? A vistoria final e suas fotos serão excluídas permanentemente. Os demais registros da VTR serão preservados.")) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/viaturas/${viatura.id}/retirada/cancelar`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registroId, confirmacao: "CANCELAR RETIRADA" }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(typeof result?.message === "string" ? result.message : "Não foi possível cancelar a retirada. Atualize a página e tente novamente.");
      }
      router.replace(`/protected/viaturas/${viatura.id}`);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Não foi possível cancelar a retirada.");
      setBusy(false);
    }
  }
  const pendingPhotos = withdrawal?.fase === "fotos";
  const canceling = withdrawal?.fase === "cancelando";
  const authorized = withdrawal?.fase === "autorizada";
  return (
    <div className="space-y-6">
      <p className="rounded-md border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
        A VTR somente será apagada depois da vistoria, do relatório completo e da sua confirmação de que salvou o PDF.
        Sair ou atualizar esta página preserva uma retirada pendente.
      </p>
      {pendingPhotos && <p role="status" className="rounded-md border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
        Há uma vistoria com envio de fotos incompleto. Ela foi preservada. Este formulário não permite retomar o envio; confirme o cancelamento abaixo apenas se desejar começar outra vistoria.
      </p>}
      {canceling && <p role="status" className="rounded-md border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
        O cancelamento anterior ficou incompleto. A retirada está preservada; confirme novamente para concluir a limpeza.
      </p>}
      {authorized && <p role="status" className="rounded-md border border-white/10 bg-[#192222] p-4 text-sm text-[#e0e8e3]">
        A exclusão desta retirada já foi autorizada. Ela não pode ser cancelada por esta página. Procure o suporte se a exclusão não foi concluída.
      </p>}
      {!withdrawal && !saved ? <InitialCheckinForm finalViatura={viatura} onFinalSaved={finalSaved} /> : saved && !authorized ? (
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
      ) : null}
      {registroId && !authorized && <button type="button" disabled={busy} onClick={() => void cancelWithdrawal()}
        className="min-h-12 w-full rounded-md border border-[#40514c] px-4 py-3 text-sm font-semibold text-[#e0e8e3] disabled:opacity-50">
        CANCELAR RETIRADA
      </button>}
      {error && <p role="alert" className="text-sm text-[#f0aaa2]">{error}</p>}
    </div>
  );
}

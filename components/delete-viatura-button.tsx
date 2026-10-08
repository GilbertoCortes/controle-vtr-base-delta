"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteViaturaButton({
  isAdmin,
  viaturaId,
}: {
  isAdmin: boolean;
  viaturaId: string | number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isAdmin) return null;

  async function handleDelete() {
    if (isSaving) return;
    if (!window.confirm("Esta ação excluirá permanentemente esta VTR, todo o seu histórico e todas as fotos vinculadas. Esta ação não poderá ser desfeita.")) {
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      const response = await fetch(`/api/viaturas/${viaturaId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmacao: "EXCLUIR DEFINITIVAMENTE" }),
      });
      const result = (await response.json().catch(() => null)) as
        | {
            message?: string | null;
            code?: string | null;
            details?: string | null;
            hint?: string | null;
          }
        | null;

      if (!response.ok) {
        setError(
          [
            `message: ${result?.message ?? "não informado"}`,
            `code: ${result?.code ?? "não informado"}`,
            `details: ${result?.details ?? "não informado"}`,
            `hint: ${result?.hint ?? "não informado"}`,
          ].join("\n"),
        );
        return;
      }

      setSuccess("VTR, histórico e fotos excluídos permanentemente.");
      window.setTimeout(() => {
        router.replace("/protected");
        router.refresh();
      }, 900);
    } catch {
      setError("Não foi possível conectar ao sistema. Tente novamente.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={handleDelete}
        aria-label="Remover da Base Delta"
        disabled={isSaving || Boolean(success)}
        title="Retirar VTR definitivamente"
        className="inline-flex size-12 items-center justify-center rounded-md border border-[#bd4c4b]/60 bg-[#301f22] p-0 text-[#f0aaa2] transition-colors hover:border-[#bd4c4b] hover:bg-[#bd4c4b] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ef9691] disabled:cursor-wait disabled:opacity-60"
      >
        {isSaving ? "…" : <Trash2 aria-hidden="true" className="size-5" />}
      </button>
      {success && <p role="status" className="text-sm text-emerald-300">{success}</p>}
      {error && (
        <p role="alert" className="max-w-xs whitespace-pre-wrap text-sm text-[#f0aaa2]">
          {error}
        </p>
      )}
    </div>
  );
}
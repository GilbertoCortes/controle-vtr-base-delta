"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

export function DeleteViaturaButton({ isAdmin, viaturaId }: { isAdmin: boolean; viaturaId: string | number }) {
  const router = useRouter();
  if (!isAdmin) return null;
  return (
    <button type="button" onClick={() => router.push(`/protected/viaturas/${viaturaId}/retirada`)}
      aria-label="Excluir VTR" title="Iniciar retirada definitiva da VTR"
      className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-md border border-[#bd4c4b]/60 bg-[#301f22] px-4 py-3 text-sm font-bold text-[#f0aaa2] transition-colors hover:border-[#bd4c4b] hover:bg-[#bd4c4b] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ef9691]">
      <Trash2 aria-hidden="true" className="size-5 shrink-0" />
      EXCLUIR VTR
    </button>
  );
}

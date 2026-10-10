"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

export function DeleteViaturaButton({ isAdmin, viaturaId }: { isAdmin: boolean; viaturaId: string | number }) {
  const router = useRouter();
  if (!isAdmin) return null;
  return (
    <button type="button" onClick={() => router.push(`/protected/viaturas/${viaturaId}/retirada`)}
      aria-label="Remover da Base Delta" title="Retirar VTR definitivamente"
      className="inline-flex size-12 items-center justify-center rounded-md border border-[#bd4c4b]/60 bg-[#301f22] p-0 text-[#f0aaa2] transition-colors hover:border-[#bd4c4b] hover:bg-[#bd4c4b] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ef9691]">
      <Trash2 aria-hidden="true" className="size-5" />
    </button>
  );
}

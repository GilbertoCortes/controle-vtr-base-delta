"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type ViaturaDraft,
  type VtrType,
  viaturaDraftScope,
} from "@/lib/vtr-draft";
import { getDraftUserId, loadDraft, saveDraft } from "@/lib/draft-storage";
import { isStrictMercosulPlate } from "@/lib/plate";

export function NewViaturaForm() {
  const router = useRouter();
  const [placa, setPlaca] = useState(""); // forma canonica, sem hifen
  const [plateTouched, setPlateTouched] = useState(false);
  const [tipo, setTipo] = useState<VtrType>("Viatura");
  const [storageError, setStorageError] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getDraftUserId().then((uid) => {
      if (!active || !uid) return;
      setUserId(uid);
      const draft = loadDraft<Partial<ViaturaDraft>>(uid, viaturaDraftScope);
      if (!draft) return;
      if (typeof draft.placa === "string") {
        const canon = draft.placa.toUpperCase();
        setPlaca(canon);
      }
      if (draft.tipo === "Viatura" || draft.tipo === "Motocicleta") {
        setTipo(draft.tipo);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  function persistDraft(next: Pick<ViaturaDraft, "placa" | "tipo">) {
    if (!userId) return false;
    const ok = saveDraft(userId, viaturaDraftScope, { ...next, situacao: "ativa" });
    setStorageError(!ok);
    return ok;
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isStrictMercosulPlate(placa)) {
      setPlateTouched(true);
      return;
    }

    const saved = persistDraft({
      placa,
      tipo,
    });
    if (saved) router.push("/protected/viaturas/nova/check-in");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 rounded-lg border border-white/10 bg-[#192222] p-5 sm:p-7"
    >
      <div className="space-y-2">
        <label htmlFor="placa" className="text-sm font-medium text-[#e0e8e3]">
          Placa
        </label>
        <input
          id="placa"
          name="placa"
          type="text"
          required
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          value={placa}
          onChange={(event) => {
            const canon = event.target.value.toUpperCase();
            setPlaca(canon);
            persistDraft({ placa: canon, tipo });
          }}
          onBlur={() => setPlateTouched(true)}
          aria-invalid={plateTouched && !isStrictMercosulPlate(placa)}
          aria-describedby="placa-error"
          className="h-12 w-full rounded-md border border-[#40514c] bg-[#111919] px-3.5 text-base uppercase text-[#f3f4ef] placeholder:normal-case placeholder:text-[#71817b] outline-none transition-colors focus:border-[#d5b45b] focus:ring-2 focus:ring-[#d5b45b]/20 sm:text-sm"
        />
        {plateTouched && !isStrictMercosulPlate(placa) && (
          <p id="placa-error" role="alert" className="text-sm text-[#f0aaa2]">
            Placa inválida. Use o formato KKK5K55.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor="tipo" className="text-sm font-medium text-[#e0e8e3]">
          Tipo
        </label>
        <select
          id="tipo"
          name="tipo"
          value={tipo}
          onChange={(event) => {
            const value = event.target.value as VtrType;
            setTipo(value);
            persistDraft({ placa, tipo: value });
          }}
          className="h-12 w-full rounded-md border border-[#40514c] bg-[#111919] px-3.5 text-base text-[#f3f4ef] outline-none transition-colors focus:border-[#d5b45b] focus:ring-2 focus:ring-[#d5b45b]/20 sm:text-sm"
        >
          <option value="Viatura">Viatura</option>
          <option value="Motocicleta">Motocicleta</option>
        </select>
      </div>

      <div className="space-y-2">
        <label htmlFor="situacao" className="text-sm font-medium text-[#e0e8e3]">
          Status inicial
        </label>
        <input
          id="situacao"
          name="situacao"
          type="text"
          value="Ativa"
          readOnly
          aria-readonly="true"
          className="h-12 w-full cursor-not-allowed rounded-md border border-[#40514c] bg-[#18211f] px-3.5 text-base text-emerald-400 outline-none sm:text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={!isStrictMercosulPlate(placa)}
        className="min-h-14 w-full rounded-md bg-[#d5b45b] px-5 text-sm font-bold text-[#17201e] transition-colors hover:bg-[#e2c675] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e2c675] focus-visible:ring-offset-2 focus-visible:ring-offset-[#192222] disabled:cursor-not-allowed disabled:opacity-50"
      >
        AVANÇAR PARA CHECK-IN/ENTRADA DE VTR
      </button>

      {storageError && (
        <p role="alert" className="text-center text-sm text-[#f0aaa2]">
          Não foi possível preservar o rascunho neste navegador.
        </p>
      )}
    </form>
  );
}
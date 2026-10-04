"use client";

import { useState } from "react";

type PerfilFuncionalValues = {
  nome_completo: string;
  rg_id: string;
  base: string;
  ala: string;
};

const basesDisponiveis = ["Base", "Alfa", "Bravo", "Charlie", "Delta"];
const alasDisponiveis = ["Alfa", "Bravo", "Charlie"];

export function PerfilFuncionalForm({
  initialValues,
}: {
  initialValues: PerfilFuncionalValues;
}) {
  const [values, setValues] = useState(initialValues);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

    function updateField(field: keyof PerfilFuncionalValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setMessage(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setMessage(null);
    setIsError(false);

    try {
      const response = await fetch("/api/meu-perfil", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome_completo: values.nome_completo.trim(),
          rg_id: values.rg_id.trim(),
          base: values.base.trim(),
          ala: values.ala.trim(),
        }),
      });
      const result = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        setIsError(true);
        setMessage(result?.message ?? "Não foi possível salvar seus dados funcionais.");
        return;
      }

      setMessage("Perfil salvo com sucesso.");
    } catch {
      setIsError(true);
      setMessage("Não foi possível conectar ao sistema. Tente novamente.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-white/10 bg-[#192222] p-5 sm:p-7">
      <label htmlFor="nome_completo" className="block space-y-2 text-sm font-medium text-[#e0e8e3]">
        Nome completo
        <input
          id="nome_completo"
          name="nome_completo"
          required
          autoComplete="name"
          value={values.nome_completo}
          onChange={(event) => updateField("nome_completo", event.target.value)}
          className="h-12 w-full rounded-md border border-[#40514c] bg-[#111919] px-3.5 text-base text-[#f3f4ef] outline-none focus:border-[#d5b45b] focus:ring-2 focus:ring-[#d5b45b]/20 sm:text-sm"
        />
      </label>
      <label htmlFor="rg_id" className="block space-y-2 text-sm font-medium text-[#e0e8e3]">
        RG / ID funcional
        <input
          id="rg_id"
          name="rg_id"
          required
          value={values.rg_id}
          onChange={(event) => updateField("rg_id", event.target.value)}
          className="h-12 w-full rounded-md border border-[#40514c] bg-[#111919] px-3.5 text-base text-[#f3f4ef] outline-none focus:border-[#d5b45b] focus:ring-2 focus:ring-[#d5b45b]/20 sm:text-sm"
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label htmlFor="base" className="block space-y-2 text-sm font-medium text-[#e0e8e3]">
          Base
          <select
            id="base"
            name="base"
            required
            value={values.base}
            onChange={(event) => updateField("base", event.target.value)}
              className="h-12 w-full rounded-md border border-[#40514c] bg-[#111919] px-3.5 text-base text-[#f3f4ef] outline-none focus:border-[#d5b45b] focus:ring-2 focus:ring-[#d5b45b]/20 sm:text-sm"
          >
            <option value="" disabled>Selecione a Base</option>
            {basesDisponiveis.map((base) => <option key={base} value={base}>{base}</option>)}
          </select>
        </label>
        <label htmlFor="ala" className="block space-y-2 text-sm font-medium text-[#e0e8e3]">
          ALA
          <select
            id="ala"
            name="ala"
            required
            value={values.ala}
            onChange={(event) => updateField("ala", event.target.value)}
              className="h-12 w-full rounded-md border border-[#40514c] bg-[#111919] px-3.5 text-base text-[#f3f4ef] outline-none focus:border-[#d5b45b] focus:ring-2 focus:ring-[#d5b45b]/20 sm:text-sm"
          >
            <option value="" disabled>Selecione a ALA</option>
            {alasDisponiveis.map((ala) => <option key={ala} value={ala}>{ala}</option>)}
          </select>
        </label>
      </div>

      {message && (
        <p role={isError ? "alert" : "status"} className={`text-sm ${isError ? "text-[#f0aaa2]" : "text-emerald-300"}`}>
          {message}
        </p>
      )}
      <button
        type="submit"
        disabled={isSaving}
        className="min-h-12 w-full rounded-md bg-[#d5b45b] px-5 text-sm font-bold text-[#17201e] transition-colors hover:bg-[#e2c675] disabled:cursor-wait disabled:opacity-60"
      >
        {isSaving ? "SALVANDO..." : "SALVAR PERFIL"}
      </button>
    </form>
  );
}
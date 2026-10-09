"use client";

import Image from "next/image";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getDraftUserId, loadDraft, removeDraft, saveDraft } from "@/lib/draft-storage";
import { formatPlate } from "@/lib/plate";

type ViaturaInfo = {
  id: string | number;
  placa: string;
  tipo: string;
  situacao: string;
};

type FotoRascunho = { id: string; nome: string; dataUrl: string };
type Rascunho = {
  answers: Record<string, string>;
  observacoes: string;
  reparosRealizados: string;
  descricaoReparos: string;
  empresa: string;
  responsavelEntrega: string;
  cpfDigits: string;
  photos: FotoRascunho[];
};

const fuelOptions = ["Vazio", "1/4", "1/2", "3/4", "Cheio"];
const conditionOptions = ["OK", "Ruim"];
const possessionOptions = ["Possui", "Não possui"];
const optionalConditionOptions = ["OK", "Ruim", "Não possui"];
const lightingItems = [
  { name: "seta_dianteira_direita", label: "Seta dianteira direita", options: conditionOptions },
  { name: "seta_dianteira_esquerda", label: "Seta dianteira esquerda", options: conditionOptions },
  { name: "seta_traseira_direita", label: "Seta traseira direita", options: conditionOptions },
  { name: "seta_traseira_esquerda", label: "Seta traseira esquerda", options: conditionOptions },
  { name: "luz_freio", label: "Luz de freio", options: conditionOptions },
  { name: "luz_alerta", label: "Luz de alerta", options: conditionOptions },
  { name: "farol_alto", label: "Farol alto", options: conditionOptions },
  { name: "farol_baixo", label: "Farol baixo", options: conditionOptions },
  { name: "buzina", label: "Buzina", options: conditionOptions },
  { name: "strobo", label: "Strobo", options: optionalConditionOptions },
  { name: "sirene", label: "Sirene", options: optionalConditionOptions },
  { name: "giroflex", label: "Giroflex", options: optionalConditionOptions },
];

type ChoiceFieldProps = {
  name: string;
  label: string;
  options: readonly string[];
  value: string | undefined;
  onChange: (name: string, value: string) => void;
};

function ChoiceField({ name, label, options, value, onChange }: ChoiceFieldProps) {
  return (
    <fieldset className="rounded-md border border-white/10 bg-[#141d1d] p-4">
      <legend className="px-1 text-sm font-medium text-[#e0e8e3]">
        {label} <span className="text-[#d5b45b]">*</span>
      </legend>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => (
          <label key={option} className="cursor-pointer">
            <input
              className="peer sr-only"
              type="radio"
              name={name}
              value={option}
              required
              checked={value === option}
              onChange={() => onChange(name, option)}
            />
            <span className="flex min-h-12 items-center justify-center rounded-md border border-[#40514c] px-2 text-center text-sm font-semibold text-[#bdc9c3] transition-colors peer-checked:border-[#d5b45b] peer-checked:bg-[#d5b45b]/15 peer-checked:text-[#f1d989] peer-focus-visible:ring-2 peer-focus-visible:ring-[#d5b45b]">
              {option}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Falha ao ler imagem."));
    reader.onerror = () => reject(new Error("Falha ao ler imagem."));
    reader.readAsDataURL(file);
  });
}

async function preparePhoto(file: File): Promise<FotoRascunho> {
  if (!file.type.startsWith("image/")) throw new Error("Arquivo não é imagem.");
  const source = await readFile(file);
  const image = new window.Image();
  image.src = source;
  await image.decode();
  const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Falha ao preparar imagem.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return {
    id: crypto.randomUUID(),
    nome: file.name,
    dataUrl: canvas.toDataURL("image/jpeg", 0.72),
  };
}

function formatCpf(digits: string) {
  const first = digits.slice(0, 3);
  const second = digits.slice(3, 6);
  const third = digits.slice(6, 9);
  const last = digits.slice(9, 11);
  let formatted = first;
  if (second) formatted += `.${second}`;
  if (third) formatted += `.${third}`;
  if (last) formatted += `-${last}`;
  return formatted;
}

function formatApiError(data: unknown) {
  const error = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const display = (value: unknown) =>
    value === null || value === undefined || value === "" ? "não informado" : String(value);
  return [
    `Código: ${display(error.code)}`,
    `Mensagem: ${display(error.message)}`,
    `Detalhes: ${display(error.details)}`,
    `Hint: ${display(error.hint)}`,
  ].join("\n");
}

export function RecebimentoOficinaForm({
  viatura,
  motivoBaixa,
}: {
  viatura: ViaturaInfo;
  motivoBaixa: string;
}) {
  const router = useRouter();
  const draftScope = `recebimento-oficina:${viatura.id}`;
  const userIdRef = useRef<string | null>(null);
  const isViatura = viatura.tipo.trim().toLowerCase() === "viatura";
  const tires = isViatura
    ? [
        { name: "pneu_dianteiro_esquerdo", label: "Pneu dianteiro esquerdo" },
        { name: "pneu_dianteiro_direito", label: "Pneu dianteiro direito" },
        { name: "pneu_traseiro_esquerdo", label: "Pneu traseiro esquerdo" },
        { name: "pneu_traseiro_direito", label: "Pneu traseiro direito" },
      ]
    : [
        { name: "pneu_dianteiro", label: "Pneu dianteiro" },
        { name: "pneu_traseiro", label: "Pneu traseiro" },
      ];
  const otherItems = isViatura
    ? [
        { name: "triangulo", label: "Triângulo" },
        { name: "chave_roda", label: "Chave de roda" },
        { name: "retrovisor_direito", label: "Retrovisor direito" },
        { name: "retrovisor_esquerdo", label: "Retrovisor esquerdo" },
      ]
    : [
        { name: "retrovisor_direito", label: "Retrovisor direito" },
        { name: "retrovisor_esquerdo", label: "Retrovisor esquerdo" },
      ];

  const [loaded, setLoaded] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [observacoes, setObservacoes] = useState("");
  const [reparosRealizados, setReparosRealizados] = useState("");
  const [descricaoReparos, setDescricaoReparos] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [responsavelEntrega, setResponsavelEntrega] = useState("");
  const [cpfDigits, setCpfDigits] = useState("");
  const [photos, setPhotos] = useState<FotoRascunho[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let active = true;
    void getDraftUserId().then((uid) => {
      if (!active) return;
      userIdRef.current = uid;
      try {
        if (uid) {
          const draft = loadDraft<Partial<Rascunho>>(uid, draftScope);
          if (draft) {
            if (draft.answers && typeof draft.answers === "object") setAnswers(draft.answers);
            if (typeof draft.observacoes === "string") setObservacoes(draft.observacoes);
            if (typeof draft.reparosRealizados === "string") setReparosRealizados(draft.reparosRealizados);
            if (typeof draft.descricaoReparos === "string") setDescricaoReparos(draft.descricaoReparos);
            if (typeof draft.empresa === "string") setEmpresa(draft.empresa);
            if (typeof draft.responsavelEntrega === "string") setResponsavelEntrega(draft.responsavelEntrega);
            if (typeof draft.cpfDigits === "string") setCpfDigits(draft.cpfDigits);
            if (Array.isArray(draft.photos)) setPhotos(draft.photos);
          }
        }
      } catch {
        setStorageError(true);
      } finally {
        if (active) setLoaded(true);
      }
    });
    return () => {
      active = false;
    };
  }, [draftScope]);

  function persist(next: Partial<Rascunho>) {
    const uid = userIdRef.current;
    if (!uid) return false;
    const ok = saveDraft(uid, draftScope, {
      answers,
      observacoes,
      reparosRealizados,
      descricaoReparos,
      empresa,
      responsavelEntrega,
      cpfDigits,
      photos,
      ...next,
    });
    setStorageError(!ok);
    return ok;
  }

  function updateAnswer(name: string, value: string) {
    const nextAnswers = { ...answers, [name]: value };
    setAnswers(nextAnswers);
    persist({ answers: nextAnswers });
    setSaveError(null);
  }

  async function addPhotos(files: File[]) {
    if (!files.length) return;
    setPhotoError(null);
    try {
      const nextPhotos = [...photos, ...(await Promise.all(files.map(preparePhoto)))];
      setPhotos(nextPhotos);
      persist({ photos: nextPhotos });
    } catch {
      setPhotoError("Não foi possível preparar uma das imagens. Tente outra foto.");
    }
  }

  function removePhoto(id: string) {
    const nextPhotos = photos.filter((photo) => photo.id !== id);
    setPhotos(nextPhotos);
    persist({ photos: nextPhotos });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || completed) return;
    if (cpfDigits.length !== 11) {
      setSaveError("Informe um CPF válido com 11 dígitos.");
      return;
    }
    if (reparosRealizados === "Sim" && !descricaoReparos.trim()) {
      setSaveError("Descreva os reparos realizados.");
      return;
    }
    // O envio usa os dados em memória mesmo quando o armazenamento está cheio.
    persist({ cpfDigits });

    setSubmitting(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/viaturas/${viatura.id}/recebimento-oficina`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers,
          observacoes,
          reparosRealizados,
          descricaoReparos,
          empresa,
          responsavelEntrega,
          cpfResponsavelEntrega: cpfDigits,
          photos,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        setSaveError(formatApiError(errorData));
        return;
      }

      if (userIdRef.current) removeDraft(userIdRef.current, draftScope);
      setCompleted(true);
      window.setTimeout(() => {
        router.replace(`/protected/viaturas/${viatura.id}`);
        router.refresh();
      }, 900);
    } catch {
      setSaveError("Não foi possível conectar ao sistema. Mantenha esta página aberta e tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!loaded) {
    return <p className="py-8 text-center text-sm text-[#a9b8b1]">Carregando rascunho...</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-7">
      <div className="grid grid-cols-1 gap-3 rounded-lg border border-white/10 bg-[#192222] p-5 sm:grid-cols-2">
        <p className="text-lg font-bold tracking-[0.06em] text-[#f3f4ef]">{formatPlate(viatura.placa)}</p>
        <p className="text-sm text-[#bdc9c3]">Tipo: {viatura.tipo}</p>
        <p className="text-sm text-[#bdc9c3]">Situação atual: {viatura.situacao}</p>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[#f3f4ef]">Dados gerais</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label htmlFor="km-recebimento" className="space-y-2 text-sm font-medium text-[#e0e8e3]">
            KM atual <span className="text-[#d5b45b]">*</span>
            <input
              id="km-recebimento"
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              required
              value={answers.km_atual ?? ""}
              onChange={(event) => updateAnswer("km_atual", event.target.value)}
              className="h-12 w-full rounded-md border border-[#40514c] bg-[#111919] px-3.5 text-base text-[#f3f4ef] outline-none focus:border-[#d5b45b] focus:ring-2 focus:ring-[#d5b45b]/20 sm:text-sm"
            />
          </label>
          <ChoiceField name="combustivel" label="Combustível" options={fuelOptions} value={answers.combustivel} onChange={updateAnswer} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceField name="oleo_motor" label="Óleo do motor" options={["Bom", "Inapropriado"]} value={answers.oleo_motor} onChange={updateAnswer} />
          <ChoiceField name="liquido_arrefecimento" label="Líquido de arrefecimento" options={["Bom", "Inapropriado"]} value={answers.liquido_arrefecimento} onChange={updateAnswer} />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[#f3f4ef]">Pneus</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {tires.map((item) => (
            <ChoiceField key={item.name} name={item.name} label={item.label} options={conditionOptions} value={answers[item.name]} onChange={updateAnswer} />
          ))}
          {isViatura && (
            <ChoiceField name="estepe" label="Estepe" options={possessionOptions} value={answers.estepe} onChange={updateAnswer} />
          )}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[#f3f4ef]">Iluminação e sinalização</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {lightingItems.map((item) => (
            <ChoiceField key={item.name} name={item.name} label={item.label} options={item.options} value={answers[item.name]} onChange={updateAnswer} />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[#f3f4ef]">Outros itens</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {otherItems.map((item) => (
            <ChoiceField key={item.name} name={item.name} label={item.label} options={possessionOptions} value={answers[item.name]} onChange={updateAnswer} />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[#f3f4ef]">
          Motivos da Solicitação de Reparos
        </h2>
        <p className="whitespace-pre-wrap rounded-md border border-white/10 bg-[#192222] p-4 text-sm leading-relaxed text-[#bdc9c3]">
          {motivoBaixa}
        </p>
        <ChoiceField
          name="reparos_realizados"
          label="Reparos realizados?"
          options={["Sim", "Não"]}
          value={reparosRealizados}
          onChange={(_, value) => {
            setReparosRealizados(value);
            persist({ reparosRealizados: value });
            setSaveError(null);
          }}
        />
        <label htmlFor="descricao-reparos" className="block space-y-2 text-sm font-medium text-[#e0e8e3]">
          Observações/reparos {reparosRealizados === "Sim" && <span className="text-[#d5b45b]">*</span>}
          <textarea
            id="descricao-reparos"
            rows={4}
            required={reparosRealizados === "Sim"}
            value={descricaoReparos}
            onChange={(event) => {
              setDescricaoReparos(event.target.value);
              persist({ descricaoReparos: event.target.value });
              setSaveError(null);
            }}
            className="w-full resize-y rounded-md border border-[#40514c] bg-[#111919] px-3.5 py-3 text-base text-[#f3f4ef] outline-none focus:border-[#d5b45b] focus:ring-2 focus:ring-[#d5b45b]/20 sm:text-sm"
          />
        </label>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <label htmlFor="empresa" className="space-y-2 text-sm font-medium text-[#e0e8e3]">
          Empresa <span className="text-[#d5b45b]">*</span>
          <input id="empresa" required value={empresa} onChange={(event) => { setEmpresa(event.target.value); persist({ empresa: event.target.value }); }} className="h-12 w-full rounded-md border border-[#40514c] bg-[#111919] px-3.5 text-base text-[#f3f4ef] outline-none focus:border-[#d5b45b] focus:ring-2 focus:ring-[#d5b45b]/20 sm:text-sm" />
        </label>
        <label htmlFor="responsavel-entrega" className="space-y-2 text-sm font-medium text-[#e0e8e3]">
          Responsável pela entrega <span className="text-[#d5b45b]">*</span>
          <input id="responsavel-entrega" required value={responsavelEntrega} onChange={(event) => { setResponsavelEntrega(event.target.value); persist({ responsavelEntrega: event.target.value }); }} className="h-12 w-full rounded-md border border-[#40514c] bg-[#111919] px-3.5 text-base text-[#f3f4ef] outline-none focus:border-[#d5b45b] focus:ring-2 focus:ring-[#d5b45b]/20 sm:text-sm" />
        </label>
        <label htmlFor="cpf-entrega" className="space-y-2 text-sm font-medium text-[#e0e8e3]">
          CPF do responsável <span className="text-[#d5b45b]">*</span>
          <input
            id="cpf-entrega"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={14}
            required
            pattern="[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}"
            placeholder="000.000.000-00"
            value={formatCpf(cpfDigits)}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, "").slice(0, 11);
              setCpfDigits(digits);
              persist({ cpfDigits: digits });
              setSaveError(null);
            }}
            className="h-12 w-full rounded-md border border-[#40514c] bg-[#111919] px-3.5 text-base text-[#f3f4ef] outline-none focus:border-[#d5b45b] focus:ring-2 focus:ring-[#d5b45b]/20 sm:text-sm"
          />
        </label>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[#f3f4ef]">Fotos no recebimento</h2>
        <div className="flex flex-wrap gap-3">
          <label htmlFor="camera-recebimento" className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-md border border-[#40514c] px-4 text-sm font-semibold text-[#e0e8e3] hover:bg-white/5">Tirar foto</label>
          <input id="camera-recebimento" type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void addPhotos(files); }} />
          <label htmlFor="galeria-recebimento" className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-md border border-[#40514c] px-4 text-sm font-semibold text-[#e0e8e3] hover:bg-white/5">Selecionar da galeria</label>
          <input id="galeria-recebimento" type="file" accept="image/*" multiple className="sr-only" onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void addPhotos(files); }} />
        </div>
        {photoError && <p role="alert" className="text-sm text-[#f0aaa2]">{photoError}</p>}
        {photos.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((photo, index) => (
              <li key={photo.id} className="relative aspect-[4/3] overflow-hidden rounded-md border border-white/10 bg-[#141d1d]">
                <Image src={photo.dataUrl} alt={`Foto ${index + 1}: ${photo.nome}`} fill unoptimized sizes="(max-width: 640px) 50vw, 33vw" className="object-cover" />
                <button type="button" onClick={() => removePhoto(photo.id)} aria-label={`Remover foto ${index + 1}`} className="absolute right-2 top-2 flex size-9 items-center justify-center rounded-full bg-[#101719]/90 text-white hover:bg-[#bd4c4b]">
                  <X aria-hidden="true" className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {storageError && <p role="alert" className="text-sm text-[#f0aaa2]">O rascunho não foi salvo neste navegador. Você pode enviar o formulário, mas mantenha esta página aberta até concluir para não perder os dados e as fotos.</p>}
      {saveError && <p role="alert" className="whitespace-pre-wrap rounded-md border border-[#bd4c4b]/35 bg-[#bd4c4b]/10 p-4 text-sm text-[#f0aaa2]">{saveError}</p>}
      {completed && <p role="status" className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">VTR recebida da oficina com sucesso.</p>}

      <div className="flex justify-end">
        <button type="submit" disabled={submitting || completed} className="min-h-14 rounded-md bg-emerald-700 px-5 text-sm font-bold text-white transition-colors hover:bg-emerald-600 disabled:cursor-wait disabled:opacity-60">{submitting ? "RECEBENDO VTR..." : "RECEBER VTR"}</button>
      </div>
    </form>
  );
}
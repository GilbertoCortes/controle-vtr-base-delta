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
  quilometragem: number | null;
};

type FotoRascunho = {
  id: string;
  nome: string;
  dataUrl: string;
};

type RascunhoBaixa = {
  answers: Record<string, string>;
  motivoObservacoes: string;
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

function formatApiError(data: unknown) {
  const error = data && typeof data === "object" ? data as Record<string, unknown> : {};
  return [
    error.message,
    error.code ? `Código: ${error.code}` : null,
    error.details ? `Detalhes: ${error.details}` : null,
    error.hint ? `Sugestão: ${error.hint}` : null,
  ]
    .filter((line): line is string => typeof line === "string" && line.length > 0)
    .join("\n") || "Não foi possível baixar a VTR. Mantenha esta página aberta e tente novamente.";
}

export function BaixaVtrForm({ viatura }: { viatura: ViaturaInfo }) {
  const router = useRouter();
  const draftScope = `baixa:${viatura.id}`;
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
  const [motivoObservacoes, setMotivoObservacoes] = useState("");
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
          const draft = loadDraft<Partial<RascunhoBaixa>>(uid, draftScope);
          if (draft) {
            if (draft.answers && typeof draft.answers === "object") setAnswers(draft.answers);
            if (typeof draft.motivoObservacoes === "string") {
              setMotivoObservacoes(draft.motivoObservacoes);
            }
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

  function persist(nextAnswers: Record<string, string>, nextMotivo: string, nextPhotos: FotoRascunho[]) {
    const uid = userIdRef.current;
    if (!uid) return false;
    const ok = saveDraft(uid, draftScope, { answers: nextAnswers, motivoObservacoes: nextMotivo, photos: nextPhotos });
    setStorageError(!ok);
    return ok;
  }

  function updateAnswer(name: string, value: string) {
    const nextAnswers = { ...answers, [name]: value };
    setAnswers(nextAnswers);
    persist(nextAnswers, motivoObservacoes, photos);
    setSaveError(null);
    setCompleted(false);
  }

  async function addPhotos(files: File[]) {
    if (!files.length) return;
    setPhotoError(null);
    try {
      const nextPhotos = [...photos, ...(await Promise.all(files.map(preparePhoto)))];
      setPhotos(nextPhotos);
      persist(answers, motivoObservacoes, nextPhotos);
    } catch {
      setPhotoError("Não foi possível preparar uma das imagens. Tente outra foto.");
    }
  }

  function removePhoto(id: string) {
    const nextPhotos = photos.filter((photo) => photo.id !== id);
    setPhotos(nextPhotos);
    persist(answers, motivoObservacoes, nextPhotos);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || completed) return;
    const motivo = motivoObservacoes.trim();
    // O envio usa os dados em memória mesmo quando o armazenamento está cheio.
    persist(answers, motivo, photos);

    setSubmitting(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/viaturas/${viatura.id}/baixa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, motivoObservacoes: motivo, photos }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setSaveError(formatApiError(data));
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
          <label htmlFor="km-baixa" className="space-y-2 text-sm font-medium text-[#e0e8e3]">
            KM atual <span className="text-[#d5b45b]">*</span>
            <input
              id="km-baixa"
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

      <section className="space-y-2">
        <label htmlFor="motivo-baixa" className="text-lg font-semibold text-[#f3f4ef]">
          Motivo / Observações <span className="text-[#d5b45b]">*</span>
        </label>
        <textarea
          id="motivo-baixa"
          rows={5}
          required
          value={motivoObservacoes}
          onChange={(event) => {
            const value = event.target.value;
            setMotivoObservacoes(value);
            persist(answers, value, photos);
            setSaveError(null);
          }}
          className="w-full resize-y rounded-md border border-[#40514c] bg-[#111919] px-3.5 py-3 text-base text-[#f3f4ef] outline-none focus:border-[#d5b45b] focus:ring-2 focus:ring-[#d5b45b]/20 sm:text-sm"
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[#f3f4ef]">Fotos da avaria</h2>
        <div className="flex flex-wrap gap-3">
          <label htmlFor="camera-baixa" className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-md border border-[#40514c] px-4 text-sm font-semibold text-[#e0e8e3] hover:bg-white/5">
            Tirar foto
          </label>
          <input
            id="camera-baixa"
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void addPhotos(files);
            }}
          />
          <label htmlFor="galeria-baixa" className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-md border border-[#40514c] px-4 text-sm font-semibold text-[#e0e8e3] hover:bg-white/5">
            Selecionar da galeria
          </label>
          <input
            id="galeria-baixa"
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void addPhotos(files);
            }}
          />
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
      {completed && <p role="status" className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">VTR baixada com sucesso.</p>}

      <div className="flex justify-end">
        <button type="submit" disabled={submitting || completed} className="min-h-14 rounded-md bg-[#bd4c4b] px-5 text-sm font-bold text-white transition-colors hover:bg-[#d15d59] disabled:cursor-wait disabled:opacity-60">
          {submitting ? "BAIXANDO VTR..." : "BAIXAR VTR"}
        </button>
      </div>
    </form>
  );
}
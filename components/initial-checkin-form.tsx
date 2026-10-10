"use client";

import Image from "next/image";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  type CheckinDraft,
  type CheckinPhoto,
  type ViaturaDraft,
  checkinDraftScope,
  viaturaDraftScope,
} from "@/lib/vtr-draft";
import { getDraftUserId, loadDraft, removeDraft, saveDraft } from "@/lib/draft-storage";
import { formatPlate } from "@/lib/plate";
import { inspectionCategories, isInspectionCategory, validateInspectionAnswers, validateInspectionPhotos, type InspectionCategory } from "@/lib/vtr-inspection";

const conditionOptions = ["OK", "Ruim"];
const possessionOptions = ["Possui", "Não possui"];
const optionalConditionOptions = ["OK", "Ruim", "Não possui"];
const fuelOptions = ["Vazio", "1/4", "1/2", "3/4", "Cheio"];

const carTires = [
  { name: "pneu_dianteiro_esquerdo", label: "Pneu dianteiro esquerdo" },
  { name: "pneu_dianteiro_direito", label: "Pneu dianteiro direito" },
  { name: "pneu_traseiro_esquerdo", label: "Pneu traseiro esquerdo" },
  { name: "pneu_traseiro_direito", label: "Pneu traseiro direito" },
];

const motorcycleTires = [
  { name: "pneu_dianteiro", label: "Pneu dianteiro" },
  { name: "pneu_traseiro", label: "Pneu traseiro" },
];

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

const carOtherItems = [
  { name: "triangulo", label: "Triângulo" },
  { name: "chave_roda", label: "Chave de roda" },
  { name: "retrovisor_direito", label: "Retrovisor direito" },
  { name: "retrovisor_esquerdo", label: "Retrovisor esquerdo" },
];

const motorcycleOtherItems = [
  { name: "retrovisor_direito", label: "Retrovisor direito" },
  { name: "retrovisor_esquerdo", label: "Retrovisor esquerdo" },
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

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Não foi possível ler a imagem."));
    };
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.readAsDataURL(file);
  });
}

async function createPhotoPreview(file: File): Promise<CheckinPhoto> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Selecione um arquivo de imagem.");
  }

  const source = await readFileAsDataUrl(file);
  const image = new window.Image();
  image.src = source;
  await image.decode();

  const maxDimension = 1200;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível preparar a imagem.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return {
    id: crypto.randomUUID(),
    name: file.name,
    dataUrl: canvas.toDataURL("image/jpeg", 0.72),
  };
}

function isViaturaDraft(value: unknown): value is ViaturaDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<ViaturaDraft>;
  return (
    typeof draft.placa === "string" &&
    (draft.tipo === "Viatura" || draft.tipo === "Motocicleta")
  );
}

export function InitialCheckinForm({ finalViatura, onFinalSaved }: {
  finalViatura?: ViaturaDraft & { id: string };
  onFinalSaved?: () => void;
} = {}) {
  const router = useRouter();
  const [loaded, setLoaded] = useState(Boolean(finalViatura));
  const [viatura, setViatura] = useState<ViaturaDraft | null>(finalViatura ?? null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [observacoes, setObservacoes] = useState("");
  const [photos, setPhotos] = useState<CheckinPhoto[]>([]);
  const [storageError, setStorageError] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPreparingPhotos, setIsPreparingPhotos] = useState(false);
  const preparingPhotosRef = useRef(false);
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (finalViatura) return;
    let active = true;
    void getDraftUserId().then((uid) => {
      if (!active) return;
      userIdRef.current = uid;
      try {
        if (uid) {
          const parsedViatura = loadDraft<ViaturaDraft>(uid, viaturaDraftScope);
          if (parsedViatura && isViaturaDraft(parsedViatura)) {
            setViatura({ ...parsedViatura, situacao: "ativa" });
          }

          const parsedCheckin = loadDraft<Partial<CheckinDraft>>(uid, checkinDraftScope);
          if (parsedCheckin) {
            if (parsedCheckin.answers && typeof parsedCheckin.answers === "object") {
              setAnswers(parsedCheckin.answers);
            }
            if (typeof parsedCheckin.observacoes === "string") {
              setObservacoes(parsedCheckin.observacoes);
            }
            if (Array.isArray(parsedCheckin.photos)) {
              setPhotos(parsedCheckin.photos.filter((photo) => isInspectionCategory(photo.categoria)));
              if (parsedCheckin.photos.some((photo) => !isInspectionCategory(photo.categoria))) {
                setPhotoError("O rascunho antigo contém fotos sem categoria. Adicione novamente as fotos nas categorias correspondentes.");
              }
            }
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
  }, [finalViatura]);

  function persistCheckin(
    nextAnswers: Record<string, string>,
    nextObservacoes: string,
    nextPhotos: CheckinPhoto[],
  ) {
    if (finalViatura) return true;
    const uid = userIdRef.current;
    if (!uid) return false;
    const draft: CheckinDraft = {
      answers: nextAnswers,
      observacoes: nextObservacoes,
      photos: nextPhotos,
    };
    const ok = saveDraft(uid, checkinDraftScope, draft);
    setStorageError(!ok);
    return ok;
  }

  function updateAnswer(name: string, value: string) {
    const nextAnswers = { ...answers, [name]: value };
    setAnswers(nextAnswers);
    persistCheckin(nextAnswers, observacoes, photos);
    setCompleted(false);
    setSubmitError(null);
  }

  function updateObservacoes(value: string) {
    setObservacoes(value);
    persistCheckin(answers, value, photos);
    setCompleted(false);
    setSubmitError(null);
  }

  async function addPhotos(files: File[], categoria: InspectionCategory) {
    if (files.length === 0 || preparingPhotosRef.current) return;
    preparingPhotosRef.current = true;
    setPhotoError(null);
    setIsPreparingPhotos(true);

    try {
      const selected = categoria === "avarias" ? files : files.slice(0, 1);
      const newPhotos: CheckinPhoto[] = [];
      for (const file of selected) newPhotos.push({ ...await createPhotoPreview(file), categoria });
      const nextPhotos = categoria === "avarias" ? [...photos, ...newPhotos] :
        [...photos.filter((photo) => photo.categoria !== categoria), ...newPhotos];
      setPhotos(nextPhotos);
      persistCheckin(answers, observacoes, nextPhotos);
      setCompleted(false);
      setSubmitError(null);
    } catch {
      setPhotoError("Não foi possível preparar uma das imagens. Tente outra foto.");
    } finally {
      preparingPhotosRef.current = false;
      setIsPreparingPhotos(false);
    }
  }

  function removePhoto(photoId: string) {
    const nextPhotos = photos.filter((photo) => photo.id !== photoId);
    setPhotos(nextPhotos);
    persistCheckin(answers, observacoes, nextPhotos);
    setCompleted(false);
    setSubmitError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!viatura || isSubmitting || completed || isPreparingPhotos) return;
    const validation = validateInspectionAnswers(answers, viatura.tipo) ?? validateInspectionPhotos(photos);
    if (validation) { setSubmitError(validation); return; }
    // O envio usa os dados em memória mesmo quando o armazenamento está cheio.
    persistCheckin(answers, observacoes, photos);

    setIsSubmitting(true);
    setCompleted(false);
    setSubmitError(null);

    try {
      const response = await fetch(finalViatura ? `/api/viaturas/${finalViatura.id}/vistoria-final` : "/api/viaturas/cadastro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalViatura ? { answers, observacoes, photos } : {
          viatura: {
            placa: viatura.placa,
            tipo: viatura.tipo,
          },
          checkin: { answers, observacoes, photos },
        }),
      });
      if (!response.ok) {
        const errorData = (await response.json().catch(() => null)) as
          | Record<string, unknown>
          | null;
        console.error("Erro cadastro VTR:", errorData);
        setSubmitError(
          JSON.stringify(
            {
              message: errorData?.message ?? "não informado",
              code: errorData?.code ?? "não informado",
              details: errorData?.details ?? "não informado",
              hint: errorData?.hint ?? "não informado",
            },
            null,
            2,
          ),
        );
        return;
      }

      if (finalViatura) {
        setCompleted(true);
        onFinalSaved?.();
        return;
      }
      if (userIdRef.current) {
        removeDraft(userIdRef.current, viaturaDraftScope);
        removeDraft(userIdRef.current, checkinDraftScope);
      }
      setCompleted(true);
      window.setTimeout(() => {
        router.replace("/protected");
        router.refresh();
      }, 900);
    } catch {
      setSubmitError(
        "Não foi possível conectar ao sistema. Mantenha esta página aberta e tente novamente.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!loaded) {
    return <p className="py-8 text-center text-sm text-[#a9b8b1]">Carregando dados temporários...</p>;
  }

  if (!viatura) {
    return (
      <div className="space-y-4 rounded-lg border border-white/10 bg-[#192222] p-5 text-center">
        <p className="text-sm text-[#e0e8e3]">
          Os dados temporários da VTR não foram encontrados.
        </p>
      </div>
    );
  }

  const tires = viatura.tipo === "Viatura" ? carTires : motorcycleTires;
  const otherItems = viatura.tipo === "Viatura" ? carOtherItems : motorcycleOtherItems;

  return (
    <form onSubmit={handleSubmit} className="space-y-7">
      <div className="rounded-lg border border-white/10 bg-[#192222] p-5 sm:p-6">
        <p className="text-2xl font-bold tracking-[0.08em] text-[#f3f4ef]">
          {formatPlate(viatura.placa)}
        </p>
        <p className="mt-1 text-sm text-[#b7c4bd]">Tipo: {viatura.tipo}</p>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[#f3f4ef]">Dados gerais</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="km_atual" className="text-sm font-medium text-[#e0e8e3]">
              KM atual <span className="text-[#d5b45b]">*</span>
            </label>
            <input
              id="km_atual"
              name="km_atual"
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              required
              value={answers.km_atual ?? ""}
              onChange={(event) => updateAnswer("km_atual", event.target.value)}
              className="h-12 w-full rounded-md border border-[#40514c] bg-[#111919] px-3.5 text-base text-[#f3f4ef] outline-none transition-colors focus:border-[#d5b45b] focus:ring-2 focus:ring-[#d5b45b]/20 sm:text-sm"
            />
          </div>
          <ChoiceField
            name="combustivel"
            label="Combustível"
            options={fuelOptions}
            value={answers.combustivel}
            onChange={updateAnswer}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceField name="pintura" label="Pintura" options={["Boa", "Ruim"]} value={answers.pintura} onChange={updateAnswer} />
          <ChoiceField name="lataria" label="Lataria" options={["Boa", "Ruim"]} value={answers.lataria} onChange={updateAnswer} />
          <ChoiceField
            name="oleo_motor"
            label="Óleo do motor"
            options={["Bom", "Inapropriado"]}
            value={answers.oleo_motor}
            onChange={updateAnswer}
          />
          <ChoiceField
            name="liquido_arrefecimento"
            label="Líquido de arrefecimento"
            options={["Bom", "Inapropriado"]}
            value={answers.liquido_arrefecimento}
            onChange={updateAnswer}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[#f3f4ef]">Pneus</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {tires.map((item) => (
            <ChoiceField
              key={item.name}
              name={item.name}
              label={item.label}
              options={conditionOptions}
              value={answers[item.name]}
              onChange={updateAnswer}
            />
          ))}
          {viatura.tipo === "Viatura" && (
            <ChoiceField
              name="estepe"
              label="Estepe"
              options={possessionOptions}
              value={answers.estepe}
              onChange={updateAnswer}
            />
          )}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[#f3f4ef]">
          Iluminação e sinalização
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {lightingItems.map((item) => (
            <ChoiceField
              key={item.name}
              name={item.name}
              label={item.label}
              options={item.options}
              value={answers[item.name]}
              onChange={updateAnswer}
            />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[#f3f4ef]">
          Outros itens para {viatura.tipo.toLowerCase()}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {otherItems.map((item) => (
            <ChoiceField
              key={item.name}
              name={item.name}
              label={item.label}
              options={possessionOptions}
              value={answers[item.name]}
              onChange={updateAnswer}
            />
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <label htmlFor="observacoes" className="text-lg font-semibold text-[#f3f4ef]">
          Observações
        </label>
        <textarea
          id="observacoes"
          name="observacoes"
          rows={5}
          value={observacoes}
          onChange={(event) => updateObservacoes(event.target.value)}
          className="w-full resize-y rounded-md border border-[#40514c] bg-[#111919] px-3.5 py-3 text-base text-[#f3f4ef] outline-none transition-colors focus:border-[#d5b45b] focus:ring-2 focus:ring-[#d5b45b]/20 sm:text-sm"
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[#f3f4ef]">Fotos da vistoria</h2>
        {inspectionCategories.map((category) => (
          <fieldset key={category.value} disabled={isSubmitting || isPreparingPhotos || completed}
            className="space-y-3 rounded-md border border-white/10 bg-[#192222] p-4">
            <legend className="text-sm font-semibold text-[#e0e8e3]">
              {category.label} {category.value !== "avarias" && <span className="text-[#d5b45b]">*</span>}
            </legend>
            <p className="text-xs text-[#a9b8b1]">{category.value === "avarias" ? "Opcional. Adicione quantas fotos forem necessárias." : "Exatamente uma foto. Adicionar outra substitui a anterior."}</p>
            <div className="flex flex-wrap gap-3">
              {["camera", "galeria"].map((source) => (
                <label key={source} className="inline-flex min-h-12 cursor-pointer items-center rounded-md border border-[#40514c] px-4 text-sm text-[#e0e8e3]">
                  {source === "camera" ? "Tirar foto" : category.value === "avarias" ? "Adicionar fotos" : "Adicionar / substituir foto"}
                  <input type="file" accept="image/*" capture={source === "camera" ? "environment" : undefined}
                    multiple={source === "galeria" && category.value === "avarias"} className="sr-only"
                    onChange={(event) => {
                      const files = Array.from(event.currentTarget.files ?? []);
                      event.currentTarget.value = "";
                      void addPhotos(files, category.value);
                    }} />
                </label>
              ))}
            </div>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.filter((photo) => photo.categoria === category.value).map((photo) => (
                <li key={photo.id} className="relative aspect-[4/3] overflow-hidden rounded-md border border-white/10">
                  <Image src={photo.dataUrl} alt={`${category.label}: ${photo.name}`} fill unoptimized sizes="(max-width: 640px) 50vw, 33vw" className="object-cover" />
                  <button type="button" onClick={() => removePhoto(photo.id)} aria-label={`Remover foto de ${category.label}`}
                    className="absolute right-2 top-2 flex size-9 items-center justify-center rounded-full bg-[#101719]/90 text-white">
                    <X aria-hidden="true" className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
        {isPreparingPhotos && <p role="status" className="text-sm text-[#a9b8b1]">Preparando fotos...</p>}
        {photoError && <p role="alert" className="text-sm text-[#f0aaa2]">{photoError}</p>}
      </section>

      {storageError && (
        <p role="alert" className="text-sm text-[#f0aaa2]">
          O rascunho não foi salvo neste navegador. Você pode enviar o formulário, mas mantenha esta página aberta até concluir para não perder os dados e as fotos.
        </p>
      )}
      {submitError && (
        <p role="alert" className="whitespace-pre-wrap rounded-md border border-[#bd4c4b]/35 bg-[#bd4c4b]/10 p-4 text-sm text-[#f0aaa2]">
          {submitError}
        </p>
      )}
      {completed && (
        <p role="status" className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
          {finalViatura ? "Vistoria final salva." : "VTR cadastrada com sucesso."}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={isSubmitting || completed || isPreparingPhotos || Boolean(validateInspectionPhotos(photos))}
          className="min-h-14 w-full rounded-md bg-[#d5b45b] px-5 text-sm font-bold text-[#17201e] transition-colors hover:bg-[#e2c675] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e2c675] focus-visible:ring-offset-2 focus-visible:ring-offset-[#101719] disabled:cursor-wait disabled:opacity-60"
        >
          {isSubmitting ? "SALVANDO..." : finalViatura ? "CONCLUIR VISTORIA FINAL" : "CONCLUIR CADASTRO"}
        </button>
      </div>
    </form>
  );
}
import type { VtrType } from "@/lib/vtr-draft";

export const inspectionCategories = [
  { value: "frente", label: "Frente" },
  { value: "lateral_direita", label: "Lateral direita" },
  { value: "lateral_esquerda", label: "Lateral esquerda" },
  { value: "traseira", label: "Traseira" },
  { value: "painel", label: "Painel" },
  { value: "equipamentos", label: "Estepe / chave de roda / macaco / triângulo" },
  { value: "avarias", label: "Avarias" },
] as const;
export type InspectionCategory = typeof inspectionCategories[number]["value"];

export function isInspectionCategory(value: unknown): value is InspectionCategory {
  return inspectionCategories.some((category) => category.value === value);
}

export function validateInspectionPhotos(value: unknown): string | null {
  if (!Array.isArray(value)) return "Adicione as seis fotos obrigatórias.";
  const counts = new Map<string, number>();
  for (const photo of value) {
    if (!photo || typeof photo !== "object" || !isInspectionCategory(photo.categoria)) {
      return "Informe uma categoria válida para cada foto.";
    }
    counts.set(photo.categoria, (counts.get(photo.categoria) ?? 0) + 1);
  }
  for (const category of inspectionCategories) {
    if (category.value !== "avarias" && counts.get(category.value) !== 1) {
      return `Adicione exatamente uma foto de ${category.label}.`;
    }
  }
  return null;
}

export function inspectionFields(tipo: VtrType): Record<string, readonly string[]> {
  const fields: Record<string, readonly string[]> = {
    pintura: ["Boa", "Ruim"], lataria: ["Boa", "Ruim"],
    oleo_motor: ["Bom", "Inapropriado"], liquido_arrefecimento: ["Bom", "Inapropriado"],
    combustivel: ["Vazio", "1/4", "1/2", "3/4", "Cheio"],
  };
  for (const field of [
    "seta_dianteira_direita", "seta_dianteira_esquerda", "seta_traseira_direita",
    "seta_traseira_esquerda", "luz_freio", "luz_alerta", "farol_alto", "farol_baixo", "buzina",
    ...(tipo === "Viatura" ? ["pneu_dianteiro_esquerdo", "pneu_dianteiro_direito", "pneu_traseiro_esquerdo", "pneu_traseiro_direito"] : ["pneu_dianteiro", "pneu_traseiro"]),
  ]) fields[field] = ["OK", "Ruim"];
  for (const field of ["strobo", "sirene", "giroflex"]) fields[field] = ["OK", "Ruim", "Não possui"];
  for (const field of ["retrovisor_direito", "retrovisor_esquerdo", ...(tipo === "Viatura" ? ["estepe", "triangulo", "chave_roda"] : [])]) {
    fields[field] = ["Possui", "Não possui"];
  }
  return fields;
}

export function validateInspectionAnswers(value: unknown, tipo: VtrType): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Preencha todos os itens obrigatórios da vistoria.";
  const answers = value as Record<string, unknown>;
  if ((typeof answers.km_atual !== "string" && typeof answers.km_atual !== "number") ||
      String(answers.km_atual).trim() === "" || !Number.isInteger(Number(answers.km_atual)) ||
      Number(answers.km_atual) < 0 || Number(answers.km_atual) > 2147483647) return "Informe um KM atual válido.";
  for (const [field, options] of Object.entries(inspectionFields(tipo))) {
    if (typeof answers[field] !== "string" || !options.includes(answers[field])) return "Preencha todos os itens obrigatórios da vistoria, incluindo Pintura e Lataria.";
  }
  return null;
}

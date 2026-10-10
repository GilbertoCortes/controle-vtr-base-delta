export type VtrType = "Viatura" | "Motocicleta";

export type ViaturaDraft = {
  placa: string;
  tipo: VtrType;
  situacao: "ativa";
};

export type CheckinPhoto = {
  id: string;
  name: string;
  dataUrl: string;
  categoria?: import("@/lib/vtr-inspection").InspectionCategory;
};

export type CheckinDraft = {
  answers: Record<string, string>;
  observacoes: string;
  photos: CheckinPhoto[];
};

// Escopos logicos dos rascunhos (a chave real e montada por lib/draft-storage
// com o UUID do usuario autenticado e timestamp).
export const viaturaDraftScope = "nova-vtr";
export const checkinDraftScope = "check-in-inicial";
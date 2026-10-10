import { Buffer } from "node:buffer";
import { isInspectionCategory, type InspectionCategory, validateInspectionPhotos } from "@/lib/vtr-inspection";

export type PreparedInspectionPhoto = {
  categoria: InspectionCategory;
  bytes: Buffer;
  contentType: string;
  extension: string;
};

export function prepareInspectionPhotos(value: unknown): PreparedInspectionPhoto[] {
  const validation = validateInspectionPhotos(value);
  if (validation) throw new Error(validation);
  if (!Array.isArray(value)) throw new Error("Fotos inválidas.");
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object" || !("categoria" in item) || !isInspectionCategory(item.categoria) ||
        !("dataUrl" in item) || typeof item.dataUrl !== "string") throw new Error("Foto inválida.");
    const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/.exec(item.dataUrl);
    if (!match) throw new Error("Selecione fotos JPEG ou PNG.");
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error("Cada foto deve ter no máximo 5 MB.");
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if ((match[1] === "image/jpeg" && !jpeg) || (match[1] === "image/png" && !png)) throw new Error("Conteúdo de foto inválido.");
    return { categoria: item.categoria, bytes, contentType: match[1], extension: jpeg ? "jpg" : "png" };
  });
}

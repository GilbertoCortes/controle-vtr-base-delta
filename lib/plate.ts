// Utilitarios centrais de placa de VTR.
//
// FORMA CANONICA (comparacao/armazenamento): somente [A-Z0-9], sem hifen,
// maiuscula, ate 7 caracteres. Ex.: "LUT5T54".
// FORMATO VISUAL (apresentacao): hifen apos os 3 primeiros. Ex.: "LUT-5T54".
//
// A VALIDACAO de que a sequencia e uma placa aceita (Mercosul) permanece na
// regex existente; estas funcoes NAO validam, apenas normalizam/formatam.

const PLATE_PATTERN = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/;

// Remove tudo que nao for letra/digito, converte para maiuscula e limita a 7.
// Aceita entrada com/sem hifen, espacos ou minusculas. Uso: comparacao e banco.
export function normalizePlate(value: string): string {
  let out = "";
  for (const ch of value.toUpperCase()) {
    if (out.length >= 7) break;
    if (/[A-Z0-9]/.test(ch)) out += ch;
  }
  return out;
}

// Insere hifen apos os 3 primeiros caracteres. Recebe qualquer entrada;
// normaliza internamente. Nao presume Mercosul — apenas divide 3 + resto.
// Ex.: "LUT5T54" -> "LUT-5T54"; "ABC1234" -> "ABC-1234"; "LUT5" -> "LUT-5".
export function formatPlate(value: string): string {
  const canonical = normalizePlate(value);
  if (canonical.length <= 3) return canonical;
  return `${canonical.slice(0, 3)}-${canonical.slice(3)}`;
}

// Mascara progressiva para o input: mantem maiusculas, sem caracteres
// invalidos, sem hifen duplicado, e insere o hifen visual apos as 3 letras.
export function maskPlate(value: string): string {
  return formatPlate(value);
}

// Validacao da placa Mercosul atualmente aceita pela aplicacao.
export function isValidPlate(value: string): boolean {
  return PLATE_PATTERN.test(normalizePlate(value));
}

export function kmRegressionMessage(currentKm: number) {
  return `A quilometragem informada não pode ser menor que a quilometragem atual da VTR (${currentKm.toLocaleString("pt-BR")} km).`;
}

export class KmRegressionError extends Error {
  readonly currentKm: number;

  constructor(currentKm: number) {
    super(kmRegressionMessage(currentKm));
    this.name = "KmRegressionError";
    this.currentKm = currentKm;
  }
}

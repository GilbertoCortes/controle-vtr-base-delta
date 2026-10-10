export const finalReportFailure = "Não foi possível gerar o relatório final. A VTR não foi excluída.";

export async function receiveFinalReport(response: Response) {
  if (!response.ok || !response.headers.get("content-type")?.startsWith("application/pdf")) throw new Error(finalReportFailure);
  const receipt = response.headers.get("x-relatorio-recibo");
  const expectedHash = response.headers.get("x-relatorio-sha256");
  const expectedSize = Number(response.headers.get("x-relatorio-bytes"));
  const blob = await response.blob();
  if (!receipt || !/^[0-9a-f]{64}$/.test(receipt) || !expectedHash ||
      !Number.isSafeInteger(expectedSize) || expectedSize <= 0 || blob.size !== expectedSize) throw new Error(finalReportFailure);
  const bytes = await blob.arrayBuffer();
  const signature = new TextDecoder().decode(bytes.slice(0, 5));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (signature !== "%PDF-" || hash !== expectedHash) throw new Error(finalReportFailure);
  return { blob, receipt };
}

export async function initiateFinalReportDownload(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: "application/pdf" });
  // Compartilhamento de arquivos precisa de um gesto direto, nao apos o fetch.
  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    await navigator.share({ files: [file], title: filename });
    return;
  }
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    if (!("download" in anchor)) throw new Error(finalReportFailure);
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // O sistema pode usar o URL depois de o evento click retornar.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

type Page<T> = { data: T[] | null; count: number | null; error: unknown };

export async function readCompleteRows<T>(
  page: (from: number, to: number) => PromiseLike<Page<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let total: number | null = null;
  do {
    const result = await page(rows.length, rows.length + 499);
    if (result.error) throw result.error;
    if (!result.data || result.count === null || !Number.isSafeInteger(result.count) || result.count < 0) {
      throw new Error("Não foi possível verificar a totalidade dos dados do relatório.");
    }
    if (total !== null && result.count !== total) throw new Error("Os dados mudaram durante a geração do relatório.");
    total = result.count;
    if ((!result.data.length && rows.length < total) || rows.length + result.data.length > total) {
      throw new Error("Uma página do relatório está incompleta.");
    }
    rows.push(...result.data);
  } while (rows.length < total);
  return rows;
}

/**
 * Executes async tasks over an array of items with controlled concurrency.
 * Ensures per-item failure isolation and maintains order of results.
 */
export async function processWithConcurrency<T, R>(
  items: T[],
  concurrencyLimit: number,
  workerFn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limit = Math.max(1, concurrencyLimit);
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      try {
        results[index] = await workerFn(items[index], index);
      } catch (err: any) {
        results[index] = {
          success: false,
          error: err?.message || String(err),
          errorCategory: 'UNHANDLED_WORKER_EXCEPTION'
        } as unknown as R;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

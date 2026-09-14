/**
 * Simple concurrency controller for processing items in parallel with a limit.
 */
export async function processWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const tasks: Promise<void>[] = [];
  const executing = new Set<Promise<void>>();

  for (const item of items) {
    const p = (async () => {
      try {
        await fn(item);
      } catch (err) {
        console.error('Concurrency task failed:', err);
      }
    })();
    
    tasks.push(p);
    executing.add(p);
    
    const clean = () => executing.delete(p);
    p.finally(clean);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  await Promise.all(tasks);
}

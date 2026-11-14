async function processWithConcurrency(items, limit, fn) {
  const tasks = [];
  const executing = /* @__PURE__ */ new Set();
  for (const item of items) {
    const p = (async () => {
      try {
        await fn(item);
      } catch (err) {
        console.error("Concurrency task failed:", err);
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
export {
  processWithConcurrency
};

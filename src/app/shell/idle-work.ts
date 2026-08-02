export function requestIdleWork(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(callback, { timeout: 1_800 });
    return () => window.cancelIdleCallback(id);
  }

  const id = window.setTimeout(callback, 900);
  return () => window.clearTimeout(id);
}

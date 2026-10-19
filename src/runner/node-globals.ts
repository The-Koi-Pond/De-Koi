// Browser globals the shared app code expects, for the Node runner process. Settings stores persist themselves to
// localStorage; on the runner that is an in-memory map (the runner has no per-user settings to keep).
class MemoryStorage {
  private readonly items = new Map<string, string>();
  get length(): number {
    return this.items.size;
  }
  clear(): void {
    this.items.clear();
  }
  getItem(key: string): string | null {
    return this.items.get(String(key)) ?? null;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.items.delete(String(key));
  }
  setItem(key: string, value: string): void {
    this.items.set(String(key), String(value));
  }
}

const runtime = globalThis as Record<string, unknown>;
for (const name of ["localStorage", "sessionStorage"]) {
  if (!(name in runtime)) runtime[name] = new MemoryStorage();
}

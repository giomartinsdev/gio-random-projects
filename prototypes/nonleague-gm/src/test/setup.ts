import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";

/**
 * jsdom in this Vitest version exposes `localStorage` as a getter that throws on
 * access, so the app's persistence layer needs a real in-memory stand-in rather
 * than a stub returning undefined.
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  key(index: number) {
    return [...this.store.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

Object.defineProperty(globalThis, "localStorage", {
  value: new MemoryStorage(),
  writable: true,
  configurable: true,
});

beforeEach(() => {
  localStorage.clear();
});

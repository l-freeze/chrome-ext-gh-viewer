import type { StorageDriver } from "../contracts";

/** メモリに保存する（テスト用）。保存した値は複製して持つ */
export function memoryDriver(initial: Record<string, unknown> = {}): StorageDriver {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    async get(key) {
      return structuredClone(data.get(key));
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
    },
    async remove(key) {
      data.delete(key);
    },
  };
}

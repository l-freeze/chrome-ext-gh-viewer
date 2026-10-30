// 設定やトークンの保存先。拡張機能では chrome.storage.local、テストではメモリを使う。

import { browser } from "wxt/browser";

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export function browserLocalStore(): KeyValueStore {
  const area = browser.storage.local;
  return {
    async get<T>(key: string) {
      const items = await area.get(key);
      return items[key] as T | undefined;
    },
    async set<T>(key: string, value: T) {
      await area.set({ [key]: value });
    },
    async remove(key: string) {
      await area.remove(key);
    },
  };
}

export function memoryStore(initial: Record<string, unknown> = {}): KeyValueStore {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    async get<T>(key: string) {
      return structuredClone(data.get(key)) as T | undefined;
    },
    async set<T>(key: string, value: T) {
      data.set(key, structuredClone(value));
    },
    async remove(key: string) {
      data.delete(key);
    },
  };
}

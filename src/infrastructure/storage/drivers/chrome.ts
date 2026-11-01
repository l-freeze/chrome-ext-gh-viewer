import { browser } from "wxt/browser";
import type { StorageDriver } from "../contracts";

/** chrome.storage.local */
export function chromeLocalDriver(): StorageDriver {
  const area = browser.storage.local;
  return {
    async get(key) {
      return (await area.get(key))[key];
    },
    async set(key, value) {
      await area.set({ [key]: value });
    },
    async remove(key) {
      await area.remove(key);
    },
  };
}

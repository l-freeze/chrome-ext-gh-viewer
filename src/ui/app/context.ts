import { createContext, useContext } from "solid-js";
import type { Manager } from "../../composition/manager";
import type { I18n } from "../i18n";

/** 画面に渡すもの。各機能の操作は manager から呼ぶ */
export interface UiDeps {
  manager: Manager;
  i18n: I18n;
  copyText: (text: string) => Promise<void>;
}

export const UiContext = createContext<UiDeps>();

export function useUi(): UiDeps {
  const deps = useContext(UiContext);
  if (!deps) throw new Error("UiContext is missing");
  return deps;
}

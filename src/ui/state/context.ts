import { createContext, useContext } from "solid-js";
import type { GitHubClient } from "../../api/client";
import type { DeviceFlow } from "../../api/deviceFlow";
import type { I18n } from "../../i18n";
import type { Downloader } from "../../platform/downloads";
import type { KeyValueStore } from "../../platform/storage";

/** 画面が使う外部とのやり取り。テストでは差し替える */
export interface AppDeps {
  i18n: I18n;
  store: KeyValueStore;
  downloader: Downloader;
  createClient: (token: string) => GitHubClient;
  /** OAuth App の Client ID がないビルドでは null */
  createDeviceFlow: (() => DeviceFlow) | null;
  copyText: (text: string) => Promise<void>;
  now: () => number;
}

export const DepsContext = createContext<AppDeps>();

export function useDeps(): AppDeps {
  const deps = useContext(DepsContext);
  if (!deps) throw new Error("DepsContext is missing");
  return deps;
}

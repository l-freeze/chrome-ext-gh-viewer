// chrome.downloads でのファイル保存。ファイルはメモリに載せずにディスクへ直接書かれ、
// リダイレクト先（署名付きのストレージ URL など）も CORS の制約を受けない。

import { browser, type Browser } from "wxt/browser";

export interface DownloadRequest {
  url: string;
  headers: Array<{ name: string; value: string }>;
  filename: string;
}

export interface Downloads {
  /** ダウンロードを開始し、ダウンロード ID を返す */
  start(request: DownloadRequest): Promise<number>;
  /** ダウンロードが中断されたら listener を呼ぶ。登録を解除する関数を返す */
  onInterrupted(listener: (id: number, reason: string) => void): () => void;
}

export function chromeDownloads(): Downloads {
  return {
    start: ({ url, headers, filename }) =>
      browser.downloads.download({ url, headers, filename, conflictAction: "uniquify", saveAs: false }),
    onInterrupted(listener) {
      const onChanged = (delta: Browser.downloads.DownloadDelta) => {
        if (delta.state?.current === "interrupted") listener(delta.id, delta.error?.current ?? "UNKNOWN");
      };
      browser.downloads.onChanged.addListener(onChanged);
      return () => browser.downloads.onChanged.removeListener(onChanged);
    },
  };
}

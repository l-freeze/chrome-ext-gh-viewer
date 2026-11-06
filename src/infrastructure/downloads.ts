// chrome.downloads でのファイル保存。ファイルはメモリに載せずにディスクへ直接書かれる。
// リクエストのヘッダーは受け付けない: chrome.downloads は転送先にもヘッダーをそのまま送るため、
// 認証情報を付けると転送先（別のサービスの保存先など）へ渡ってしまう。認証が要るなら、先に署名つきの URL を得てから渡す。

import { browser, type Browser } from "wxt/browser";

export interface DownloadRequest {
  /** 認証なしで取れる URL（署名つきの URL など） */
  url: string;
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
    start: ({ url, filename }) => browser.downloads.download({ url, filename, conflictAction: "uniquify", saveAs: false }),
    onInterrupted(listener) {
      const onChanged = (delta: Browser.downloads.DownloadDelta) => {
        if (delta.state?.current === "interrupted") listener(delta.id, delta.error?.current ?? "UNKNOWN");
      };
      browser.downloads.onChanged.addListener(onChanged);
      return () => browser.downloads.onChanged.removeListener(onChanged);
    },
  };
}

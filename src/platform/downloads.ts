import { browser, type Browser } from "wxt/browser";
import type { DownloadRequest } from "../api/client";

export interface Downloader {
  /** ダウンロードを開始し、ダウンロード ID を返す */
  download(request: DownloadRequest & { filename: string }): Promise<number>;
  /** ダウンロードが中断されたら listener を呼ぶ。登録を解除する関数を返す */
  onInterrupted(listener: (id: number, reason: string) => void): () => void;
}

/**
 * chrome.downloads で保存する。API の /zip は署名付きのストレージ URL へリダイレクトするが、
 * ダウンロードは CORS の制約を受けず、ファイルはメモリに載せずにディスクへ直接書かれる。
 */
export function browserDownloader(): Downloader {
  return {
    download: ({ url, headers, filename }) =>
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

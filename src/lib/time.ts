// 時間の計算と待ち。

export const DAY_MS = 24 * 60 * 60 * 1000;

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

/** 中断できる待ち。中断されたら AbortError（DOMException）で失敗する */
export const sleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const aborted = () => new DOMException("Aborted", "AbortError");
    if (signal?.aborted) return reject(aborted());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(aborted());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** ローカル時刻の暦日の通し番号（日付の差を数えるため） */
export function localDay(ms: number): number {
  const d = new Date(ms);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** UTC の YYYY-MM-DD */
export function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** from から to までに経った日数（切り捨て）。from が不明なら null */
export function elapsedDays(fromIso: string | null, nowMs: number): number | null {
  return fromIso === null ? null : Math.floor((nowMs - Date.parse(fromIso)) / DAY_MS);
}

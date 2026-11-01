// 複数の対象への処理を、同時実行数を抑えて行う。

export interface Progress {
  done: number;
  total: number;
}

/** 同時実行数を limit に抑えて fn を適用する。結果は入力と同じ順に並ぶ。1 つでも失敗したら残りを止めて失敗する */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i]!, i);
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/** 対象ごとの成否 */
export type Settled<T, R> = { item: T; ok: true; value: R } | { item: T; ok: false; error: unknown };

export interface SettleOptions<T, R> {
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: Progress, result: Settled<T, R>) => void;
}

/**
 * 対象ごとに fn を実行し、成否を記録する。1 つの失敗では止めない。
 * 中断（signal）されたら、その時点で残りを止めて失敗する。
 */
export async function settleEach<T, R>(
  items: readonly T[],
  fn: (item: T, signal: AbortSignal | undefined) => Promise<R>,
  options: SettleOptions<T, R> = {},
): Promise<Settled<T, R>[]> {
  let done = 0;
  return mapWithConcurrency(items, options.concurrency ?? 4, async (item) => {
    if (options.signal?.aborted) throw abortReason(options.signal);
    let result: Settled<T, R>;
    try {
      result = { item, ok: true, value: await fn(item, options.signal) };
    } catch (error) {
      if (options.signal?.aborted) throw abortReason(options.signal);
      result = { item, ok: false, error };
    }
    done++;
    options.onProgress?.({ done, total: items.length }, result);
    return result;
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

/** 中断による失敗か */
export function isAbort(e: unknown): boolean {
  return (e instanceof DOMException && e.name === "AbortError") || (e instanceof Error && e.name === "AbortError");
}

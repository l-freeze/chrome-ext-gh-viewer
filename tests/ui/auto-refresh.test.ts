import { describe, expect, it } from "vitest";
import { HOURLY_REQUEST_BUDGET, intervalForRequests, MIN_BUDGETED_INTERVAL_MS } from "../../src/ui/app/auto-refresh";

describe("自動更新の間隔", () => {
  it("1 時間あたりの呼び出しが上限の 1 割に収まるように、分単位で切り上げる（最短 5 分）", () => {
    expect(HOURLY_REQUEST_BUDGET).toBe(500);
    expect(intervalForRequests(6)).toBe(MIN_BUDGETED_INTERVAL_MS);
    expect(intervalForRequests(41)).toBe(5 * 60_000);
    expect(intervalForRequests(42)).toBe(6 * 60_000);
    expect(intervalForRequests(100)).toBe(12 * 60_000);
    expect(intervalForRequests(200)).toBe(24 * 60_000);
  });
});

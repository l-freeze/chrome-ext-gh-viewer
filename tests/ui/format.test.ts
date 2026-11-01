import { describe, expect, it } from "vitest";
import { formatBytes, formatDate, formatPercent, labelTextColor } from "../../src/ui/format";
import { createI18n } from "../../src/ui/i18n";

const MB = 1024 * 1024;
const { number } = createI18n("en");

describe("表示用の整形", () => {
  it("formatBytes は 1024 進で単位を上げる", () => {
    expect(formatBytes(0, number)).toBe("0 B");
    expect(formatBytes(1023, number)).toBe("1,023 B");
    expect(formatBytes(1536, number)).toBe("1.5 KB");
    expect(formatBytes(1018.6 * MB, number)).toBe("1,018.6 MB");
    expect(formatBytes(2.5 * 1024 * MB, number)).toBe("2.5 GB");
  });
  it("formatDate はローカル時刻の YYYY-MM-DD", () => {
    expect(formatDate(new Date(2026, 0, 2, 23, 59).toISOString())).toBe("2026-01-02");
    expect(formatDate(null)).toBeNull();
    expect(formatDate("garbage")).toBeNull();
  });
  it("formatPercent", () => {
    expect(formatPercent(0.614, number)).toBe("61%");
    expect(formatPercent(NaN, number)).toBe("0%");
  });
  it("labelTextColor は明るい背景に黒、暗い背景に白", () => {
    expect(labelTextColor("a2eeef")).toBe("#000000");
    expect(labelTextColor("b60205")).toBe("#ffffff");
    expect(labelTextColor(null)).toBe("#000000");
  });
});

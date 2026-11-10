import { describe, expect, it } from "vitest";
import { formatBytes, formatDate, formatDuration, formatPercent, labelTextColor } from "../../src/ui/format";
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

describe("時間の長さ", () => {
  it("分を日・時間・分に分け、0 の単位は出さない（英語は単数・複数を切り替える）", () => {
    const { t } = createI18n("en");
    expect(formatDuration(1440, t)).toBe("1 day");
    expect(formatDuration(120, t)).toBe("2 hours");
    expect(formatDuration(160, t)).toBe("2 hours 40 minutes");
    expect(formatDuration(1, t)).toBe("1 minute");
    expect(formatDuration(25 * 60 + 1, t)).toBe("1 day 1 hour 1 minute");
    expect(formatDuration(0, t)).toBe("0 minutes");
  });

  it("日本語", () => {
    const { t } = createI18n("ja");
    expect(formatDuration(1440, t)).toBe("1 日");
    expect(formatDuration(160, t)).toBe("2 時間 40 分");
    expect(formatDuration(5, t)).toBe("5 分");
  });

  it("自動更新の説明に使う", () => {
    const en = createI18n("en").t;
    const ja = createI18n("ja").t;
    expect(en("autoRefresh.title", { count: 1440, interval: formatDuration(1440, en) })).toBe("Refresh every 1 day while this screen is open");
    expect(en("autoRefresh.title", { count: 1, interval: formatDuration(1, en) })).toBe("Refresh every minute while this screen is open");
    expect(ja("autoRefresh.title", { count: 160, interval: formatDuration(160, ja) })).toBe("この画面を開いている間、2 時間 40 分ごとに取り直します");
  });
});

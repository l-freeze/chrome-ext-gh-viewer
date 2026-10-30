import { describe, expect, it } from "vitest";
import { createI18n, resolveLocale } from "../src/i18n";
import { en } from "../src/i18n/en";
import { ja } from "../src/i18n/ja";

describe("resolveLocale", () => {
  it.each([
    ["ja", "ja"],
    ["ja-JP", "ja"],
    ["ja_JP", "ja"],
    ["en-US", "en"],
    ["fr", "en"],
    ["", "en"],
    [undefined, "en"],
    [null, "en"],
  ] as const)("%s → %s", (input, expected) => {
    expect(resolveLocale(input)).toBe(expected);
  });
});

describe("createI18n", () => {
  it("パラメーターを埋め、数値は言語に合わせて区切る", () => {
    expect(createI18n("en").t("loading.progress", { done: 1200, total: 3400 })).toBe("1,200 / 3,400 repositories");
  });

  it("英語は count で単数・複数を切り替える", () => {
    const { t } = createI18n("en");
    expect(t("artifacts.deleted", { count: 1 })).toBe("Deleted 1 artifact.");
    expect(t("artifacts.deleted", { count: 2 })).toBe("Deleted 2 artifacts.");
  });

  it("日本語の文言", () => {
    expect(createI18n("ja").t("artifacts.deleted", { count: 3 })).toBe("3 件を削除しました。");
  });

  it("両言語でパラメーター名がそろっている", () => {
    const params = (m: string | { one: string; other: string }) =>
      [...new Set([...(typeof m === "string" ? m : m.one + m.other).matchAll(/\{(\w+)\}/g)].map((x) => x[1]))].sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      // 日本語は単数・複数を同じ文にしているので count を使わないことがある
      const jaParams = params(ja[key]).filter((p) => p !== "count");
      const enParams = params(en[key]).filter((p) => p !== "count");
      expect(jaParams, key).toEqual(enParams);
    }
  });
});

import { en, type MessageKey, type Messages } from "./en";
import { ja } from "./ja";

export type Locale = "en" | "ja";
export type { MessageKey };

const catalogs: Record<Locale, Messages> = { en, ja };

/** ブラウザの UI 言語から使う言語を決める。対応していない・不明なら英語 */
export function resolveLocale(uiLanguage: string | null | undefined): Locale {
  const lang = uiLanguage?.toLowerCase() ?? "";
  if (lang === "ja" || lang.startsWith("ja-") || lang.startsWith("ja_")) return "ja";
  return "en";
}

export type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;

export interface I18n {
  locale: Locale;
  t: Translate;
  /** 数値を言語に合わせて区切る */
  number: (n: number, options?: Intl.NumberFormatOptions) => string;
}

export function createI18n(locale: Locale): I18n {
  const messages = catalogs[locale];
  const plural = new Intl.PluralRules(locale);
  const nf = new Intl.NumberFormat(locale);
  const number = (n: number, options?: Intl.NumberFormatOptions) =>
    options ? new Intl.NumberFormat(locale, options).format(n) : nf.format(n);

  const t: Translate = (key, params = {}) => {
    const message = messages[key];
    let template: string;
    if (typeof message === "string") {
      template = message;
    } else {
      const count = Number(params["count"] ?? 0);
      template = plural.select(count) === "one" ? message.one : message.other;
    }
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
      const v = params[name];
      if (v === undefined) return match;
      return typeof v === "number" ? number(v) : v;
    });
  };

  return { locale, t, number };
}

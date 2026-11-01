// 画面表示用の整形。言語に依存する部分は number（Intl.NumberFormat）を受け取る。

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** 1024 進でバイト数を表す（例: 616.8 MB） */
export function formatBytes(bytes: number, number: (n: number, o?: Intl.NumberFormatOptions) => string): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 ? 0 : 1;
  return `${number(value, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${UNITS[unit]}`;
}

/** ローカル時刻での YYYY-MM-DD。null なら null */
export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 0〜1 の割合を百分率の文字列にする（例: 61%） */
export function formatPercent(ratio: number, number: (n: number, o?: Intl.NumberFormatOptions) => string): string {
  return number(Number.isFinite(ratio) ? ratio : 0, { style: "percent", maximumFractionDigits: 0 });
}

/** ラベルの背景色（6 桁の 16 進数）に対して読みやすい文字色を返す */
export function labelTextColor(hex: string | null): "#000000" | "#ffffff" {
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return "#000000";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
  return luminance > 0.4 ? "#000000" : "#ffffff";
}

// 全画面・主な状態のスクリーンショットを撮り、1 枚の HTML（gallery.html）にまとめる。
// 使い方: node e2e/capture.cjs <OAuth ありのビルド> <OAuth なしのビルド> <出力ディレクトリ>
const path = require("node:path");
const fs = require("node:fs");
const { launch } = require("./harness.cjs");

const [extOAuth, extNoOAuth, outArg] = process.argv.slice(2);
const OUT = path.resolve(outArg ?? path.join(__dirname, "screenshots/capture"));
fs.mkdirSync(OUT, { recursive: true });

const shots = [];
async function shot(page, section, file, caption, { fullPage = false } = {}) {
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, file), fullPage });
  shots.push({ section, file, caption });
  console.log("captured", file);
}

const url = (id, hash = "") => `chrome-extension://${id}/manager.html${hash}`;
const rows = (page) => page.locator("td.cell-name", { hasText: "parquet-sample-export" }).waitFor();
const loaded = (page) => page.waitForFunction(() => !document.querySelector(".row--skeleton"));

async function addPat(page, id, token, { ja = false } = {}) {
  await page.goto(url(id, "#settings"));
  const radio = page.getByRole("radio", { name: ja ? /^Personal Access Token/ : /^Personal access token/ });
  if (!(await radio.isChecked())) await radio.check();
  await page.getByPlaceholder(/ghp_/).fill(token);
  await page.getByRole("button", { name: ja ? "追加" : "Add token" }).click();
}

async function connected(page, id, opts) {
  await addPat(page, id, "ghp_capture_token_1234", opts);
  await page.getByText("ghp_…1234").waitFor();
  await page.goto(url(id, "#artifacts"));
  await rows(page);
  await loaded(page);
}

(async () => {
  // ---- 設定・オンボーディング（英語・ライト） -------------------------------------
  {
    const { context, page, id } = await launch({ ext: extOAuth });
    await page.goto(url(id));
    await page.getByRole("heading").first().waitFor();
    await shot(page, "Settings", "01-onboarding.png", "未接続: オンボーディング");

    await page.goto(url(id, "#settings"));
    await page.getByRole("button", { name: "Sign in with GitHub" }).waitFor();
    await shot(page, "Settings", "02-settings-oauth.png", "設定: GitHub でログイン（未ログイン）");

    await page.getByRole("button", { name: "Sign in with GitHub" }).click();
    await page.getByText("WXYZ-1234").waitFor();
    await shot(page, "Settings", "03-settings-oauth-code.png", "設定: Device Flow のコード表示（承認待ち）");

    await page.getByText("Signed in as octo-dev").waitFor();
    await shot(page, "Settings", "04-settings-oauth-signed-in.png", "設定: ログイン済み");

    await addPat(page, id, "ghp_capture_token_1234");
    await page.getByText("ghp_…1234").waitFor();
    await addPat(page, id, "github_pat_11CAPTURE_finegrained_5678");
    await page.getByText("github_pat_…5678").waitFor();
    await addPat(page, id, "ghp_narrow_scope_9012");
    await page.getByText("ghp_…9012").waitFor();
    await shot(page, "Settings", "05-settings-pat-list.png", "設定: PAT 一覧（Classic / Fine-grained / スコープ不足の警告）");

    await page.getByPlaceholder(/ghp_/).fill("ghp_revoked_token_0000");
    await page.getByRole("button", { name: "Add token" }).click();
    await page.getByRole("alert").waitFor();
    await shot(page, "Settings", "06-settings-pat-error.png", "設定: 無効なトークンを追加したときのエラー");

    await page.getByPlaceholder(/ghp_/).fill("ghp_capture_token_1234");
    await page.getByRole("button", { name: "Add token" }).click();
    await page.getByRole("alert").filter({ hasText: "already" }).waitFor();
    await shot(page, "Settings", "07-settings-pat-duplicate.png", "設定: 同じトークンを追加したとき");
    await context.close();
  }
  if (extNoOAuth) {
    const { context, page, id } = await launch({ ext: extNoOAuth });
    await page.goto(url(id, "#settings"));
    await page.getByText(/Sign-in is not available/).waitFor();
    await shot(page, "Settings", "08-settings-no-oauth.png", "設定: Client ID なしのビルド（PAT のみ）");
    await context.close();
  }

  // ---- アーティファクト（英語・ライト） ---------------------------------------------
  {
    const { context, page, id } = await launch({ ext: extOAuth, delayMs: 700 });
    await addPat(page, id, "ghp_capture_token_1234");
    await page.getByText("ghp_…1234").waitFor();
    await page.goto(url(id, "#artifacts"));
    await page.locator(".row--skeleton").first().waitFor();
    await page.locator("tbody tr:not(.row--skeleton)").first().waitFor();
    await shot(page, "Artifacts", "10-artifacts-loading.png", "読み込み中（上部に進捗、表の末尾に仮の行）");
    await rows(page);
    await loaded(page);
    await context.close();
  }
  {
    const { context, page, id } = await launch({ ext: extOAuth });
    await connected(page, id);
    await shot(page, "Artifacts", "11-artifacts.png", "一覧（全体）", { fullPage: true });

    await page.getByText("1 repository could not be read").click();
    await shot(page, "Artifacts", "12-artifacts-failures.png", "読み込めなかったリポジトリ（SSO の承認リンク）");
    await page.getByText("1 repository could not be read").click();

    await page.getByRole("button", { name: /Select 3 older than 30 days/ }).click();
    await shot(page, "Artifacts", "13-artifacts-selected.png", "30 日より古い 3 件を選択（操作バー・上部のメーター）");

    await page.getByRole("button", { name: "Delete 3" }).click();
    await shot(page, "Artifacts", "14-artifacts-confirm-delete.png", "削除の確認（その場で確認）");

    await page.getByRole("button", { name: "Delete permanently" }).click();
    await page.getByText("Deleted 3 artifacts.").waitFor();
    await shot(page, "Artifacts", "15-artifacts-deleted.png", "削除後の通知");
    await page.getByRole("button", { name: "Close" }).click();

    await page.getByRole("radio", { name: "Expired" }).click();
    await shot(page, "Artifacts", "16-artifacts-filter-expired.png", "絞り込み: 期限切れのみ");
    await page.getByRole("radio", { name: "All" }).click();

    await page.locator("label", { hasText: "At least" }).locator("input").fill("100");
    await page.getByRole("button", { name: /Size/ }).click();
    await shot(page, "Artifacts", "17-artifacts-filter-size.png", "絞り込み: 100 MB 以上、サイズ順");
    await page.locator("label", { hasText: "At least" }).locator("input").fill("");

    await page.getByPlaceholder("Filter by name").fill("no-such-repo");
    await shot(page, "Artifacts", "18-artifacts-empty.png", "条件に合うものがないとき");
    await page.getByPlaceholder("Filter by name").fill("");

    await page.locator("button.owner", { hasText: "acme-labs" }).click();
    await shot(page, "Artifacts", "19-artifacts-owner-off.png", "所有者 acme-labs を外したとき");
    await page.locator("button.owner", { hasText: "acme-labs" }).click();

    await page.getByRole("button", { name: "Download playwright-report" }).click();
    await page.getByText(/Download of playwright-report failed|Started 1 download/).waitFor();
    await page.waitForTimeout(1500);
    await shot(page, "Artifacts", "20-artifacts-download-failed.png", "ダウンロード失敗の通知（偽トークンのため GitHub が 401 を返した）");

    // ---- Issue ----
    await page.getByRole("link", { name: /^Issues/ }).click();
    await page.getByRole("link", { name: /Billing page crashes/ }).waitFor();
    await shot(page, "Issues", "21-issues-open.png", "Issue: Open（リポジトリごと）");

    await page.getByText("1 owner could not be searched").click();
    await shot(page, "Issues", "22-issues-failures.png", "検索できなかった所有者");
    await page.getByText("1 owner could not be searched").click();

    await page.getByPlaceholder(/Title, label/).fill("bug");
    await shot(page, "Issues", "23-issues-filter.png", "絞り込み: bug");
    await page.getByPlaceholder(/Title, label/).fill("");

    await page.getByRole("radio", { name: "Closed" }).click();
    await page.getByRole("link", { name: /Dark mode contrast/ }).waitFor();
    await shot(page, "Issues", "24-issues-closed.png", "Issue: Closed");

    await page.getByRole("radio", { name: "All" }).click();
    await page.getByRole("link", { name: /Billing page crashes/ }).waitFor();
    await shot(page, "Issues", "25-issues-all.png", "Issue: すべて");

    // ---- カンバン ----
    await page.getByRole("link", { name: /^Issues/ }).hover();
    await page.locator(".tab-menu__list").getByRole("link", { name: "Kanban" }).waitFor();
    await shot(page, "Kanban", "26-issues-menu.png", "Issue タブにマウスを合わせたときのメニュー");
    await page.locator(".tab-menu__list").getByRole("link", { name: "Kanban" }).click();
    await page.mouse.move(700, 600);
    await page.getByRole("link", { name: /Billing page crashes/ }).waitFor();
    await page.waitForFunction(() => !document.querySelector(".board__message"));
    await shot(page, "Kanban", "27-kanban.png", "カンバン（プロジェクトごと、Issue とドラフト）", { fullPage: true });
    await page.getByRole("button", { name: "Pull requests", exact: true }).click();
    await page.getByRole("button", { name: /Mobile releases/ }).click();
    await shot(page, "Kanban", "28-kanban-pr-collapsed.png", "PR も表示し、Mobile releases を折りたたんだところ", { fullPage: true });
    await page.getByRole("button", { name: /Mobile releases/ }).click();
    await page.getByRole("button", { name: "Pull requests", exact: true }).click();
    const card = page.locator(".card", { hasText: "Billing page crashes" });
    const box = await card.boundingBox();
    const target = await page.locator(".board", { hasText: "Platform roadmap" }).getByRole("group", { name: "In progress", exact: true }).boundingBox();
    await page.mouse.move(box.x + 40, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(target.x + 60, target.y + 20, { steps: 8 });
    await shot(page, "Kanban", "29-kanban-dragging.png", "ドラッグ中（落とせる列を強調）");
    await page.mouse.up();
    await context.close();
  }

  // ---- ダーク ---------------------------------------------------------------------
  {
    const { context, page, id } = await launch({ ext: extOAuth, colorScheme: "dark" });
    await connected(page, id);
    await page.getByRole("button", { name: /Select 3 older than 30 days/ }).click();
    await shot(page, "Dark", "30-dark-artifacts.png", "ダーク: アーティファクト（選択中）");
    await page.getByRole("button", { name: "Delete 3" }).click();
    await shot(page, "Dark", "31-dark-confirm-delete.png", "ダーク: 削除の確認");
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("link", { name: /^Issues/ }).click();
    await page.getByRole("link", { name: /Billing page crashes/ }).waitFor();
    await shot(page, "Dark", "32-dark-issues.png", "ダーク: Issue");
    await page.goto(url(id, "#issues/kanban"));
    await page.getByRole("link", { name: /Billing page crashes/ }).waitFor();
    await page.waitForFunction(() => !document.querySelector(".board__message"));
    await shot(page, "Dark", "34-dark-kanban.png", "ダーク: カンバン");
    await page.goto(url(id, "#settings"));
    await page.getByText("ghp_…1234").waitFor();
    await shot(page, "Dark", "33-dark-settings.png", "ダーク: 設定");
    await context.close();
  }

  // ---- 日本語 ---------------------------------------------------------------------
  {
    const { context, page, id } = await launch({ ext: extOAuth, locale: "ja-JP" });
    await page.goto(url(id));
    await page.getByRole("heading").first().waitFor();
    await shot(page, "日本語", "40-ja-onboarding.png", "日本語: オンボーディング");
    await connected(page, id, { ja: true });
    await shot(page, "日本語", "41-ja-artifacts.png", "日本語: アーティファクト");
    await page.getByRole("button", { name: /30 日より古い 3 件を選択/ }).click();
    await page.getByRole("button", { name: "3 件を削除" }).click();
    await shot(page, "日本語", "42-ja-confirm-delete.png", "日本語: 削除の確認");
    await page.getByRole("button", { name: "キャンセル" }).click();
    await page.getByRole("link", { name: /^Issue/ }).click();
    await page.getByRole("link", { name: /Billing page crashes/ }).waitFor();
    await shot(page, "日本語", "43-ja-issues.png", "日本語: Issue");
    await page.goto(url(id, "#issues/kanban"));
    await page.getByRole("link", { name: /Billing page crashes/ }).waitFor();
    await page.waitForFunction(() => !document.querySelector(".board__message"));
    await shot(page, "日本語", "45-ja-kanban.png", "日本語: カンバン");
    await page.goto(url(id, "#settings"));
    await page.getByText("ghp_…1234").waitFor();
    await shot(page, "日本語", "44-ja-settings.png", "日本語: 設定");
    await context.close();
  }

  // ---- 狭い画面 -------------------------------------------------------------------
  {
    const { context, page, id } = await launch({ ext: extOAuth, viewport: { width: 420, height: 900 } });
    await connected(page, id);
    await shot(page, "狭い画面（幅 420px）", "50-narrow-artifacts.png", "幅 420px: アーティファクト");
    await page.getByRole("link", { name: /^Issues/ }).click();
    await page.getByRole("link", { name: /Billing page crashes/ }).waitFor();
    await shot(page, "狭い画面（幅 420px）", "51-narrow-issues.png", "幅 420px: Issue");
    await page.getByRole("link", { name: /^Issues/ }).hover();
    await page.locator(".tab-menu__list").getByRole("link", { name: "Kanban" }).waitFor();
    await shot(page, "狭い画面（幅 420px）", "53-narrow-issues-menu.png", "幅 420px: Issue のメニュー（タブの行が横にスクロールしても切れない）");
    await page.locator(".tab-menu__list").getByRole("link", { name: "Kanban" }).click();
    await page.mouse.move(200, 800);
    await page.getByRole("link", { name: /Billing page crashes/ }).waitFor();
    await page.waitForFunction(() => !document.querySelector(".board__message"));
    await shot(page, "狭い画面（幅 420px）", "54-narrow-kanban.png", "幅 420px: カンバン（列は枠の中で横にスクロール）");
    console.log("narrow kanban horizontal overflow(px):", await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
    await page.goto(url(id, "#settings"));
    await page.getByText("ghp_…1234").waitFor();
    await shot(page, "狭い画面（幅 420px）", "52-narrow-settings.png", "幅 420px: 設定");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    console.log("narrow settings horizontal overflow(px):", overflow);
    await context.close();
  }

  // ---- 1 枚の HTML にまとめる ----------------------------------------------------------
  const sections = [...new Set(shots.map((s) => s.section))];
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>画面一覧</title><style>
:root{--bg:#f5f6f8;--fg:#19212c;--muted:#6a7484;--card:#fff;--border:#dfe3e8}
@media (prefers-color-scheme:dark){:root{--bg:#0e131a;--fg:#e4e9f0;--muted:#8893a4;--card:#151b24;--border:#283242}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--border);padding:10px 16px;z-index:1}
nav a{margin-right:14px;color:inherit}
main{padding:16px;max-width:1500px;margin:auto}
h2{margin:28px 0 10px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,640px),1fr));gap:16px}
figure{margin:0;background:var(--card);border:1px solid var(--border);border-radius:8px;overflow:hidden}
figure img{display:block;width:100%;height:auto}
figcaption{padding:8px 12px;color:var(--muted)}
</style></head><body><header><strong>画面一覧</strong>（偽の GitHub 応答で撮影）<nav>${sections
    .map((s, i) => `<a href="#s${i}">${esc(s)}</a>`)
    .join("")}</nav></header><main>${sections
    .map(
      (s, i) =>
        `<h2 id="s${i}">${esc(s)}</h2><div class="grid">${shots
          .filter((x) => x.section === s)
          .map(
            (x) =>
              `<figure><img loading="lazy" alt="${esc(x.caption)}" src="data:image/png;base64,${fs
                .readFileSync(path.join(OUT, x.file))
                .toString("base64")}"><figcaption>${esc(x.caption)}</figcaption></figure>`,
          )
          .join("")}</div>`,
    )
    .join("")}</main></body></html>`;
  fs.writeFileSync(path.join(OUT, "gallery.html"), html);
  console.log(`\n${shots.length} screenshots → ${path.join(OUT, "gallery.html")}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

// ビルド済みの拡張機能を Chromium に読み込み、GitHub API を偽の応答に差し替えて画面を操作する。
// 使い方: npm run e2e（OAuth の画面も確かめるため、ダミーの Client ID を入れてビルドする）
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { launch } = require("./harness.cjs");

const OUT = path.resolve(process.argv[2] ?? path.join(__dirname, "screenshots"));
fs.mkdirSync(OUT, { recursive: true });

async function connect(page, id) {
  await page.goto(`chrome-extension://${id}/manager.html#settings`);
  await page.getByRole("radio", { name: /^Personal access token/ }).check();
  await page.getByPlaceholder(/ghp_/).fill("ghp_e2e_fake_token_1234");
  await page.getByRole("button", { name: "Add token" }).click();
  await page.getByText("ghp_…1234").waitFor();
}

const steps = [];
const step = async (name, fn) => {
  await fn();
  steps.push(name);
  console.log("ok -", name);
};

(async () => {
  // ---- 英語・ライト ---------------------------------------------------------
  const { context, page, id, log, errors, dispatches, deletes } = await launch();

  await step("未接続ならオンボーディングを表示", async () => {
    await page.goto(`chrome-extension://${id}/manager.html`);
    await page.getByRole("heading", { name: "Connect your GitHub account" }).waitFor();
    await page.screenshot({ path: path.join(OUT, "01-onboarding.png") });
  });

  await step("PAT を追加するとトークン情報を表示", async () => {
    await connect(page, id);
    await page.getByText("Scopes: repo, read:org").waitFor();
    await page.getByText("Expires 2027-01-31").waitFor();
    await page.screenshot({ path: path.join(OUT, "02-settings-pat.png") });
  });

  await step("全リポジトリのアーティファクトを一覧し、読めないリポジトリを示す", async () => {
    await page.goto(`chrome-extension://${id}/manager.html#artifacts`);
    await page.locator("td.cell-name", { hasText: "parquet-sample-export" }).waitFor();
    await page.waitForFunction(() => !document.querySelector(".row--skeleton"));
    assert.equal(await page.locator("tbody tr").count(), 12);
    await page.getByText("1 repository could not be read").waitFor();
    await page.getByRole("button", { name: /acme-labs/ }).waitFor();
    await page.screenshot({ path: path.join(OUT, "03-artifacts.png") });
  });

  await step("SSO が必要なリポジトリは承認リンクを出す", async () => {
    await page.getByText("1 repository could not be read").click();
    const link = page.getByRole("link", { name: "Authorize" });
    assert.match(await link.getAttribute("href"), /locked-corp\/sso/);
    await page.getByText("1 repository could not be read").click();
  });

  await step("古いものをまとめて選ぶ", async () => {
    await page.getByRole("button", { name: /Select 3 older than 30 days/ }).click();
    await page.getByText("3 selected").waitFor();
    await page.screenshot({ path: path.join(OUT, "04-selected.png") });
  });

  await step("削除は確認してから実行し、一覧から消す", async () => {
    await page.getByRole("button", { name: "Delete 3" }).click();
    await page.getByText(/Permanently delete 3 artifacts/).waitFor();
    await page.screenshot({ path: path.join(OUT, "05-confirm-delete.png") });
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await page.getByText("Deleted 3 artifacts.").waitFor();
    assert.equal(await page.locator("tbody tr").count(), 9);
    assert.equal(log.filter((l) => l.startsWith("DELETE")).length, 3);
  });

  await step("絞り込み: 状態とサイズ", async () => {
    await page.getByRole("radio", { name: "Expired" }).click();
    assert.equal(await page.locator("tbody tr").count(), 3);
    await page.getByRole("radio", { name: "All" }).click();
    await page.locator("label", { hasText: "At least" }).locator("input").fill("100");
    assert.equal(await page.locator("tbody tr").count(), 2);
    await page.locator("label", { hasText: "At least" }).locator("input").fill("");
  });

  await step("所有者を外すとその所有者の行が消える", async () => {
    await page.getByRole("button", { name: /^octo-dev/ }).click();
    assert.equal(await page.locator("tbody tr").count(), 7);
    await page.getByRole("button", { name: /^octo-dev/ }).click();
    assert.equal(await page.locator("tbody tr").count(), 9);
  });

  await step("ダウンロードを chrome.downloads で開始する", async () => {
    await page.getByRole("button", { name: "Download playwright-report" }).click();
    await page.getByText(/Started 1 download\.|Download of playwright-report failed/).waitFor();
    // chrome.downloads の通信は Playwright の route で差し替えられないため、Chrome が記録した内容だけを確認する
    const [sw] = context.serviceWorkers();
    await page.waitForTimeout(2000);
    const items = await sw.evaluate(() => chrome.downloads.search({}));
    const item = items[0];
    assert.match(item.url, /\/repos\/acme-labs\/web-console\/actions\/artifacts\/\d+\/zip$/);
    console.log("   download state:", item.state, item.error ?? "", "finalUrl:", item.finalUrl);
    // 偽のトークンなので本物の GitHub に拒否される。中断を画面に出せているかを確認する
    if (item.state === "interrupted") await page.getByText(/Download of playwright-report failed/).waitFor();
  });

  await step("Issue を所有者横断でリポジトリごとに表示", async () => {
    await page.getByRole("link", { name: /^Issues/ }).click();
    await page.getByRole("link", { name: "Billing page crashes when the invoice list is empty" }).waitFor();
    await page.getByText("1 owner could not be searched").waitFor();
    assert.equal(await page.locator(".group-row").count(), 5);
    await page.screenshot({ path: path.join(OUT, "06-issues.png") });
    await page.getByPlaceholder(/Title, label/).fill("bug");
    assert.equal(await page.locator("tbody tr:not(.group-row)").count(), 3);
    await page.getByPlaceholder(/Title, label/).fill("");
    await page.getByRole("radio", { name: "Closed" }).click();
    await page.getByRole("link", { name: "Dark mode contrast on the settings screen" }).waitFor();
  });

  await step("Actions: ワークフローをリポジトリごとに表示し、無効なものは既定で隠す", async () => {
    await page.getByRole("link", { name: /^Actions/ }).click();
    await page.getByRole("link", { name: "Deploy", exact: true }).waitFor();
    assert.equal(await page.locator(".group-row").count(), 3);
    assert.equal(await page.getByText("Nightly cleanup").count(), 0);
    await page.getByLabel("Hide disabled").uncheck();
    await page.getByText("Nightly cleanup").waitFor();
    await page.getByLabel("Hide disabled").check();
    await page.screenshot({ path: path.join(OUT, "10-actions.png") });
  });

  await step("Actions: 手動実行できないワークフローはそう伝える", async () => {
    await page.getByRole("button", { name: "Run CI" }).click();
    await page.getByText(/can't be run manually/).waitFor();
    await page.keyboard.press("Escape");
    await page.locator("dialog[open]").waitFor({ state: "detached" }).catch(() => {});
    assert.equal(await page.locator("dialog[open]").count(), 0);
  });

  await step("Actions: 入力を検証し、確認の画面を経てから実行する", async () => {
    await page.getByRole("button", { name: "Run Deploy" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel(/^environment/).waitFor();
    // 必須の未入力と数値の誤り
    await dialog.getByLabel(/^replicas/).fill("two");
    await dialog.getByRole("button", { name: "Review" }).click();
    await dialog.getByText("Enter a value.").waitFor();
    await dialog.getByText("Enter a number.").waitFor();
    await dialog.getByLabel(/^environment/).selectOption("staging");
    await dialog.getByLabel(/^level/).selectOption("debug");
    await dialog.getByLabel(/^dry_run/).uncheck();
    await dialog.getByLabel(/^replicas/).fill("3");
    await page.screenshot({ path: path.join(OUT, "11-dispatch-form.png") });
    await dialog.getByRole("button", { name: "Review" }).click();
    await dialog.getByRole("heading", { name: "Run this workflow?" }).waitFor();
    await page.screenshot({ path: path.join(OUT, "12-dispatch-confirm.png") });
    assert.equal(dispatches.length, 0, "確認の画面に来ただけでは実行しない");
    // 戻っても入力は残る
    await dialog.getByRole("button", { name: "Back" }).click();
    assert.equal(await dialog.getByLabel(/^replicas/).inputValue(), "3");
    await dialog.getByRole("button", { name: "Review" }).click();
    await dialog.getByRole("button", { name: "Run workflow" }).click();
    await dialog.getByText(/The run was requested on master/).waitFor();
    await page.screenshot({ path: path.join(OUT, "13-dispatch-done.png") });
    assert.equal(dispatches.length, 1);
    assert.deepEqual(dispatches[0].body, {
      ref: "master",
      inputs: { environment: "staging", level: "debug", dry_run: "false", replicas: "3" },
    });
    await dialog.getByRole("button", { name: "Close" }).click();
  });

  await step("Actions: 権限不足のときは必要な権限を箇条書きで示す", async () => {
    await page.getByRole("button", { name: "Run Nightly export" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByText("GitHub says this needs:").waitFor();
    await dialog.locator(".permission-hint li", { hasText: "Contents: Read-only" }).waitFor();
    await dialog.locator(".permission-hint li", { hasText: "repo" }).waitFor();
    await page.screenshot({ path: path.join(OUT, "14-dispatch-permission.png") });
    await dialog.getByRole("button", { name: "Close" }).click();
  });

  await step("Actions: ブランチを変えると、そのブランチの定義を読み直す", async () => {
    await page.getByRole("button", { name: "Run Release" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByText("This workflow has no inputs.").waitFor();
    await dialog.getByLabel("Branch").selectOption("legacy");
    await dialog.getByText(/On legacy, this workflow has no workflow_dispatch trigger/).waitFor();
    await dialog.getByRole("button", { name: "Close" }).click();
    assert.equal(dispatches.length, 1);
  });

  await step("キャッシュ: 全リポジトリのキャッシュを一覧し、PR のキャッシュをまとめて消す", async () => {
    await page.getByRole("link", { name: /^Caches/ }).click();
    await page.locator("td.cell-name", { hasText: "Linux-node-modules-8c1f" }).waitFor();
    assert.equal(await page.locator("tbody tr").count(), 7);
    await page.getByText("1 repository could not be read").waitFor();
    await page.screenshot({ path: path.join(OUT, "15-caches.png") });
    await page.getByRole("button", { name: /Select 3 pull request caches/ }).click();
    await page.getByText("3 selected").waitFor();
    await page.getByRole("button", { name: "Delete 3" }).click();
    await page.getByText(/Permanently delete 3 caches/).waitFor();
    assert.equal(deletes.filter((d) => d.startsWith("cache")).length, 0, "確認前には消さない");
    await page.screenshot({ path: path.join(OUT, "16-caches-confirm.png") });
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await page.getByText(/Deleted 3 caches/).waitFor();
    assert.equal(deletes.filter((d) => d.startsWith("cache")).length, 3);
    assert.equal(await page.locator("tbody tr").count(), 4);
    assert.equal(await page.locator("td.cell-branch", { hasText: "PR #" }).count(), 0);
  });

  await step("実行履歴の整理: 条件で検索し、リポジトリを選び、確認してから消す", async () => {
    await page.getByRole("link", { name: /^Actions/ }).click();
    await page.getByRole("tab", { name: "Clean up run history" }).click();
    await page.getByLabel("Result").selectOption("failure");
    await page.getByRole("button", { name: "Find runs" }).click();
    // web-console: CI 15 件 + Deploy 4 件、data-pipeline: 4 件（作成から 35 日以上で失敗のもの）
    await page.getByText("23 runs match (repositories: 2).").waitFor();
    const searches = log.filter((l) => l.includes("/actions/runs?") && l.includes("created="));
    assert.ok(searches.every((l) => l.includes("status=failure")), "結果の条件を API に渡す");
    await page.screenshot({ path: path.join(OUT, "17-runs-results.png") });
    // data-pipeline を外す
    await page.getByRole("checkbox", { name: "acme-labs/data-pipeline" }).uncheck();
    await page.getByText("19 runs selected (repositories: 1)").waitFor();
    // 条件を変えると、検索し直すまで消せない
    await page.getByLabel("Result").selectOption("all");
    await page.getByText(/The conditions changed/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Delete 19 runs" }).isDisabled(), true);
    await page.getByLabel("Result").selectOption("failure");
    await page.getByRole("button", { name: "Delete 19 runs" }).click();
    await page.getByText(/Permanently delete 19 workflow runs/).waitFor();
    await page.getByText(/This sends 19 requests/).waitFor();
    await page.screenshot({ path: path.join(OUT, "18-runs-confirm.png") });
    assert.equal(deletes.filter((d) => d.startsWith("run")).length, 0, "確認前には消さない");
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await page.getByText("Deleted 19 runs.").waitFor();
    assert.equal(deletes.filter((d) => d.startsWith("run")).length, 19);
    // 外したリポジトリの分だけが残る
    await page.getByText("4 runs match (repositories: 1).").waitFor();
  });

  assert.deepEqual(errors, [], "page errors");
  await context.close();

  // ---- OAuth（Device Flow） ---------------------------------------------------
  {
    const { context, page, id, log } = await launch();
    await step("GitHub でログイン: コードを表示し、承認後にログイン状態になる", async () => {
      await page.goto(`chrome-extension://${id}/manager.html#settings`);
      await page.getByRole("button", { name: "Sign in with GitHub" }).click();
      await page.getByText("WXYZ-1234").waitFor();
      await page.screenshot({ path: path.join(OUT, "09-oauth-code.png") });
      await page.getByText("Signed in as octo-dev").waitFor();
      assert.ok(log.includes("POST github.com/login/oauth/access_token"));
      await page.goto(`chrome-extension://${id}/manager.html#artifacts`);
      await page.locator("td.cell-name", { hasText: "parquet-sample-export" }).waitFor();
    });
    await context.close();
  }

  // ---- 実行中のワークフローの状態の更新 ------------------------------------------
  {
    const { context, page, id, log, control } = await launch();
    await step("Actions: 実行中のものがある間だけ 1 分おきに状態を取り直す", async () => {
      // 時計を差し替え、1 分待つ代わりに早送りする
      await page.clock.install();
      await connect(page, id);
      await page.goto(`chrome-extension://${id}/manager.html#actions`);
      const ciRow = page.locator("tr", { has: page.getByRole("link", { name: "CI", exact: true }) });
      await ciRow.getByText("In progress").waitFor();
      const runsCalls = () => log.filter((l) => l.startsWith("GET /repos/acme-labs/web-console/actions/runs")).length;
      const before = runsCalls();
      control.completeAllRuns();
      await page.clock.fastForward("00:59");
      await page.waitForTimeout(300);
      assert.equal(runsCalls(), before, "1 分たつまでは取り直さない");
      await page.clock.fastForward("00:02");
      await ciRow.getByText("Success").waitFor();
      assert.equal(runsCalls(), before + 1);
      // 実行中のものがなくなったら、それ以上は問い合わせない
      await page.clock.fastForward("05:00");
      await page.waitForTimeout(300);
      assert.equal(runsCalls(), before + 1);
      assert.equal(log.filter((l) => l.startsWith("GET /repos/acme-labs/data-pipeline/actions/runs")).length, 1);
    });
    await context.close();
  }

  // ---- ダーク ---------------------------------------------------------------
  {
    const { context, page, id } = await launch({ colorScheme: "dark" });
    await connect(page, id);
    await page.goto(`chrome-extension://${id}/manager.html#artifacts`);
    await page.locator("td.cell-name", { hasText: "parquet-sample-export" }).waitFor();
    await page.waitForFunction(() => !document.querySelector(".row--skeleton"));
    await page.getByRole("button", { name: /Select 3 older than 30 days/ }).click();
    await page.screenshot({ path: path.join(OUT, "07-artifacts-dark.png") });
    await context.close();
    steps.push("ダークモード");
  }

  // ---- 日本語 ---------------------------------------------------------------
  {
    const { context, page, id } = await launch({ locale: "ja-JP" });
    await page.goto(`chrome-extension://${id}/manager.html`);
    const title = await page.locator("h1").textContent();
    console.log("ja onboarding title:", title);
    if (title.includes("GitHub アカウント")) {
      await page.goto(`chrome-extension://${id}/manager.html#settings`);
      await page.getByRole("radio", { name: /^Personal Access Token/ }).check();
      await page.getByPlaceholder(/ghp_/).fill("ghp_e2e_fake_token_1234");
      await page.getByRole("button", { name: "追加" }).click();
      await page.getByText("ghp_…1234").waitFor();
      await page.goto(`chrome-extension://${id}/manager.html#artifacts`);
      await page.locator("td.cell-name", { hasText: "parquet-sample-export" }).waitFor();
      await page.waitForFunction(() => !document.querySelector(".row--skeleton"));
      await page.screenshot({ path: path.join(OUT, "08-artifacts-ja.png") });
      steps.push("日本語表示");
    }
    await context.close();
  }

  console.log(`\n${steps.length} steps passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

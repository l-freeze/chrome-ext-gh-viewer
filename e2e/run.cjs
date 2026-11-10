// ビルド済みの拡張機能を Chromium に読み込み、GitHub API を偽の応答に差し替えて画面を操作する。
// 使い方: npm run e2e（OAuth の画面も確かめるため、ダミーの Client ID を入れてビルドする）
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { launch } = require("./harness.cjs");
const fx = require("./fixtures.cjs");

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
  const { context, page, id, log, errors, dispatches, deletes, control, storage } = await launch();
  // 落としたファイルの記録。保存先へトークン（Authorization）が渡っていないことと、中身が zip であることを確かめる
  const downloaded = async (urlPattern) => {
    const [sw] = context.serviceWorkers();
    await sw.evaluate(async () => {
      for (let i = 0; i < 50; i++) {
        const [latest] = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 1 });
        if (latest && latest.state !== "in_progress") return;
        await new Promise((r) => setTimeout(r, 100));
      }
    });
    const [item] = await sw.evaluate(() => chrome.downloads.search({ orderBy: ["-startTime"], limit: 1 }));
    assert.match(item.url, urlPattern);
    assert.equal(item.state, "complete", `${item.state} ${item.error ?? ""}`);
    assert.equal(fs.readFileSync(item.filename).subarray(0, 2).toString(), "PK");
    const hit = storage.requests.filter((r) => item.url.includes(r.path));
    assert.ok(hit.length > 0, "保存先へのリクエストがない");
    assert.ok(storage.requests.every((r) => r.authorization === null), JSON.stringify(storage.requests));
    return item;
  };

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
    await page.getByText("Started 1 download.").waitFor();
    // GitHub の API には頼むが、Chrome のダウンロードには保存先の署名つきの URL だけを渡す
    assert.ok(log.some((l) => /^GET \/repos\/acme-labs\/web-console\/actions\/artifacts\/\d+\/zip$/.test(l)));
    // 保存するファイル名は Playwright が付け替えるので、ここでは確かめない（単体テストで確かめている）
    await downloaded(/^https:\/\/fakeresults\.blob\.core\.windows\.net\/results\/\d+\.zip\?sig=artifact$/);
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

  await step("Issue タブのメニューから、カンバンへ移る", async () => {
    await page.getByRole("link", { name: /^Issues/ }).hover();
    const menu = page.locator(".tab-menu__list");
    await menu.getByRole("link", { name: "Kanban" }).waitFor();
    await page.screenshot({ path: path.join(OUT, "06b-issues-menu.png") });
    await menu.getByRole("link", { name: "Kanban" }).click();
    assert.match(page.url(), /#issues\/kanban$/);
    await page.getByRole("button", { name: /Platform roadmap/ }).waitFor();
    await page.getByRole("link", { name: "Billing page crashes when the invoice list is empty" }).waitFor();
  });

  const kanbanBoard = (title) => page.locator(".board", { has: page.getByRole("button", { name: new RegExp(title) }) });
  const kanbanColumn = (board, name) => kanbanBoard(board).getByRole("group", { name, exact: true });
  const itemRequests = () => log.filter((l) => /^GET \/(orgs|users)\/[^/]+\/projectsV2\/\d+\/items/.test(l));

  await step("カンバン: プロジェクトごとに Status の列で並べ、閉じたプロジェクトとアーカイブ済みの項目は出さない", async () => {
    assert.equal(await page.locator(".board").count(), 3);
    assert.equal(await page.getByRole("button", { name: /Design system 2024/ }).count(), 0);
    await page.getByText("Projects of 1 owner could not be loaded").click();
    // Organization のプロジェクトは、Fine-grained PAT の Organization permissions の Projects か、Classic PAT の read:project を案内する
    await page.locator(".failures").getByText(/with locked-corp as the resource owner, Organization permissions → Projects: Read-only/).waitFor();
    await page.locator(".failures").getByText("Classic token: the read:project scope (project to move cards)").waitFor();
    await page.getByText("Projects of 1 owner could not be loaded").click();
    assert.equal(await kanbanColumn("Platform roadmap", "Todo").locator(".card").count(), 2);
    assert.equal(await kanbanColumn("Platform roadmap", "No Status").locator(".card").count(), 1);
    // 既定では PR を出さない
    assert.equal(await page.getByText("Show an empty state on the invoice list").count(), 0);
    assert.equal(await page.getByText("Dark mode contrast on the settings screen").count(), 0);
    // フィールドの値は Status だけを求める
    assert.ok(log.includes("GET /orgs/acme-labs/projectsV2/1/items?per_page=100&fields=301"));
    await page.screenshot({ path: path.join(OUT, "06c-kanban.png") });
  });

  await step("カンバン: PR の表示を切り替えても取得し直さない", async () => {
    const before = log.length;
    await page.getByRole("button", { name: "Pull requests", exact: true }).click();
    await page.getByText("Show an empty state on the invoice list").waitFor();
    assert.equal(await kanbanColumn("Platform roadmap", "Done").locator(".card").count(), 1);
    await page.getByRole("button", { name: "Pull requests", exact: true }).click();
    assert.equal(await page.getByText("Show an empty state on the invoice list").count(), 0);
    assert.deepEqual(log.slice(before), []);
  });

  await step("カンバン: ドラッグ＆ドロップとキーボードで Status を変える", async () => {
    const card = page.locator(".card", { hasText: "Billing page crashes" });
    // Playwright はマウスを押した後でドロップ先へスクロールするため、スクロールの要らない列の見出しへ落とす
    await card.dragTo(kanbanColumn("Platform roadmap", "In progress"), { targetPosition: { x: 100, y: 12 } });
    await kanbanColumn("Platform roadmap", "In progress").locator(".card", { hasText: "Billing page crashes" }).waitFor();
    await page.waitForFunction(() => !document.querySelector(".card--moving"));
    const id412 = control.projectItems["acme-labs/1"][0].id;
    assert.deepEqual(control.patches, [{ project: "acme-labs/1", item: id412, body: { fields: [{ id: 301, value: "doing" }] } }]);
    await page.locator(".card", { hasText: "Billing page crashes" }).focus();
    await page.keyboard.press("ArrowRight");
    await kanbanColumn("Platform roadmap", "Done").locator(".card", { hasText: "Billing page crashes" }).waitFor();
    assert.equal(control.patches.at(-1).body.fields[0].value, "done");
    // 動かしたカードにフォーカスが残る
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.includes("Billing page crashes")), true);
  });

  await step("カンバン: 動かせなかったら元の列に戻し、必要な権限を示す", async () => {
    control.failMoves = true;
    await page.locator(".card", { hasText: "Null partitions" }).dragTo(kanbanColumn("Platform roadmap", "Done"), { targetPosition: { x: 100, y: 12 } });
    await page.getByText(/Could not move “Null partitions break the nightly parquet export”/).waitFor();
    await page.locator(".notice--error").getByText(/with acme-labs as the resource owner, Organization permissions → Projects: Read and write/).waitFor();
    await kanbanColumn("Platform roadmap", "In progress").locator(".card", { hasText: "Null partitions" }).waitFor();
    await page.screenshot({ path: path.join(OUT, "06d-kanban-move-failed.png") });
    control.failMoves = false;
    await page.getByRole("button", { name: "Close" }).click();
  });

  await step("カンバン: 個人アカウントのプロジェクトは Fine-grained PAT では読めないことと、Classic PAT が要ることを示す", async () => {
    control.failUserProjects = true;
    await page.getByRole("button", { name: "Refresh" }).click();
    await page.getByText("Projects of 2 owners could not be loaded").click();
    const failures = page.locator(".failures");
    await failures.getByText("Fine-grained tokens cannot read projects owned by a personal account (GitHub does not support it).").waitFor();
    await failures.getByText("To show them, add a classic token.").waitFor();
    await failures.getByRole("link", { name: /Create a classic token/ }).waitFor();
    await page.screenshot({ path: path.join(OUT, "06g-kanban-personal-projects.png") });
    control.failUserProjects = false;
    await page.getByRole("button", { name: "Refresh" }).click();
    await page.getByText("Projects of 1 owner could not be loaded").waitFor();
  });

  await step("カンバン: 別のプロジェクトへドラッグすると、確認のあとで移す（ドラフトは移せない）", async () => {
    const card = () => page.locator(".board", { hasText: "Mobile releases" }).locator(".card", { hasText: "Upgrade to the new push notification SDK" });
    const target = kanbanColumn("Platform roadmap", "Todo");
    const dialog = page.locator("dialog.transfer-dialog");
    // 取り消せば何も送らない
    await card().dragTo(target, { targetPosition: { x: 100, y: 12 } });
    await dialog.getByText("Move to another project?").waitFor();
    await dialog.getByText("Move “Upgrade to the new push notification SDK” from “acme-labs / Mobile releases” to “Todo” in “acme-labs / Platform roadmap”.").waitFor();
    await page.screenshot({ path: path.join(OUT, "06h-kanban-transfer-confirm.png") });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    assert.deepEqual(control.projectChanges, []);
    await card().waitFor();

    await card().dragTo(target, { targetPosition: { x: 100, y: 12 } });
    await dialog.getByRole("button", { name: "Move", exact: true }).click();
    await target.locator(".card", { hasText: "Upgrade to the new push notification SDK" }).waitFor();
    assert.equal(await card().count(), 0);
    const movedId = control.projectItems["acme-labs/1"].at(-1).id;
    assert.deepEqual(control.projectChanges, [
      { project: "acme-labs/1", method: "POST", body: { type: "Issue", owner: "acme-labs", repo: "mobile-app", number: 1203 } },
      { project: "acme-labs/3", method: "DELETE", item: fx.projectItems["acme-labs/3"][0].id },
    ]);
    assert.deepEqual(control.patches.at(-1), { project: "acme-labs/1", item: movedId, body: { fields: [{ id: 301, value: "todo" }] } });

    // ドラフトは別のプロジェクトへ落とせない（確認も出さず、何も送らない）
    const before = control.projectChanges.length;
    await page.locator(".board", { hasText: "Platform roadmap" }).locator(".card", { hasText: "Plan the Q1 load test" })
      .dragTo(kanbanColumn("Mobile releases", "Ready"), { targetPosition: { x: 100, y: 12 } });
    await page.waitForTimeout(300);
    assert.equal(await dialog.isVisible(), false);
    assert.equal(control.projectChanges.length, before);
  });

  await step("カンバン: 折りたたんだプロジェクトは覚えておき、開くまで項目を取得しない", async () => {
    await page.getByRole("button", { name: /Mobile releases/ }).click();
    assert.equal(await page.getByRole("button", { name: /Mobile releases/ }).getAttribute("aria-expanded"), "false");
    await page.reload();
    await page.getByRole("link", { name: "Billing page crashes when the invoice list is empty" }).waitFor();
    assert.equal(await page.getByRole("button", { name: /Mobile releases/ }).getAttribute("aria-expanded"), "false");
    const mobile = () => itemRequests().filter((l) => l.includes("/acme-labs/projectsV2/3/")).length;
    const before = mobile();
    await page.waitForTimeout(300);
    assert.equal(mobile(), before);
    await page.getByRole("button", { name: /Mobile releases/ }).click();
    // 項目は前のステップで別のプロジェクトへ移したので、列が出るのを待つ
    await kanbanColumn("Mobile releases", "Backlog").waitFor();
    assert.equal(mobile(), before + 1);
  });

  await step("Issue タブを押すと一覧に戻る", async () => {
    await page.getByRole("link", { name: /^Issues/ }).click();
    await page.locator(".group-row").first().waitFor();
    assert.match(page.url(), /#issues$/);
  });

  await step("Releases: リポジトリごとに新しい順に並べ、添付ファイルをダウンロードできる", async () => {
    const before = log.length;
    await page.getByRole("link", { name: /^Releases/ }).click();
    const table = page.locator("table.table--releases");
    await table.getByRole("link", { name: "master build" }).waitFor();
    assert.equal(await table.locator(".group-row").count(), 2);
    assert.equal(await table.locator("tbody tr:not(.group-row)").count(), 4);
    // 名前のない Release はタグ名で出す
    await table.getByRole("link", { name: "v2.3.0", exact: true }).waitFor();
    await table.locator("tr", { hasText: "master build" }).getByText("Pre-release").waitFor();
    await page.getByText("1 repository could not be read").waitFor();
    await page.screenshot({ path: path.join(OUT, "06f-releases.png") });

    await page.getByRole("radio", { name: "Pre-releases" }).click();
    assert.equal(await table.locator("tbody tr:not(.group-row)").count(), 2);
    await page.getByRole("radio", { name: "All" }).click();

    await table.getByRole("button", { name: "Download chrome-extension.zip" }).click();
    await page.getByText(/Started downloading chrome-extension.zip\.|Download of chrome-extension.zip failed/).waitFor();
    await downloaded(/^https:\/\/release-assets\.githubusercontent\.com\/assets\/\d+\?sig=release$/);
    // リポジトリごとに 1 回だけ読む。書き込みの呼び出しはしない
    const requests = log.slice(before).filter((l) => l.includes("/releases"));
    assert.equal(requests.filter((l) => l.startsWith("GET /repos/acme-labs/web-console/releases?")).length, 1);
    assert.ok(requests.every((l) => l.startsWith("GET ")), requests.join("\n"));
  });

  await step("シークレットと変数: リポジトリと Environment の分を、リポジトリごとに閲覧だけできる", async () => {
    const before = log.length;
    await page.getByRole("link", { name: /^Secrets & Variables/ }).click();
    const table = page.locator("table.table--secrets");
    await table.getByText("DEPLOY_KEY").waitFor();
    // 全リポジトリを読み終えてから数える（DEPLOY_KEY の web-console が先に読み終わることがある）
    await page.getByText("7 items").waitFor();
    assert.equal(await table.locator(".group-row").count(), 2);
    assert.equal(await table.locator("tbody tr:not(.group-row)").count(), 7);
    // Secrets の値は出さない（GitHub も返さない）。Variables は値を出す。Environment の名前を範囲に出す
    const deployKey = table.locator("tr", { hasText: "DEPLOY_KEY" });
    await deployKey.getByText(/^Hidden/).waitFor();
    await deployKey.getByText("production").waitFor();
    await table.locator("tr", { hasText: "NODE_VERSION" }).getByText("26", { exact: true }).waitFor();
    await page.getByText("1 repository could not be read").click();
    await page.locator(".failures").getByText("Secrets", { exact: false }).first().waitFor();
    await page.screenshot({ path: path.join(OUT, "06e-secrets.png") });
    await page.getByText("1 repository could not be read").click();

    await page.getByRole("radio", { name: "Variables" }).click();
    assert.equal(await table.locator("tbody tr:not(.group-row)").count(), 3);
    await page.getByPlaceholder(/Name, value, environment/).fill("staging");
    assert.equal(await table.locator("tbody tr:not(.group-row)").count(), 1);
    await page.getByPlaceholder(/Name, value, environment/).fill("");
    await page.getByRole("radio", { name: "All" }).click();

    // 読むだけで、書き込みの呼び出しはしない。Environment がある分だけ呼び出しが増える
    const requests = log.slice(before).filter((l) => /\/(actions\/(secrets|variables)|environments)/.test(l));
    assert.ok(requests.every((l) => l.startsWith("GET ")), requests.join("\n"));
    const forRepo = (r) => requests.filter((l) => l.includes(`/repos/${r}/`)).length;
    assert.equal(forRepo("acme-labs/web-console"), 3 + 2 * 2);
  });

  await step("シークレットと変数の比較表: 名前ごとに、どのリポジトリ・Environment にあるかを並べる（呼び出しは増えない）", async () => {
    const before = log.length;
    await page.getByRole("link", { name: /^Secrets & Variables/ }).hover();
    await page.locator(".tab-menu__list").getByRole("link", { name: "Matrix" }).click();
    await page.mouse.move(200, 800);
    const table = page.locator("table.table--matrix");
    await table.getByText("ITCH_API_KEY").waitFor();
    // 列: web-console のリポジトリ単位・production・staging と、tile-game のリポジトリ単位
    assert.deepEqual(await table.locator("thead .matrix__repo").allInnerTexts(), ["acme-labs/web-console", "octo-dev/tile-game"]);
    assert.equal(await table.locator("thead .matrix__scope").count(), 4);
    assert.equal(await table.locator("tbody tr:not(.group-row)").count(), 6);
    await page.getByText("6 names").waitFor();
    // リポジトリ単位の NPM_TOKEN は Environment でも使える。tile-game には無い
    const npm = table.locator("tr", { hasText: "NPM_TOKEN" });
    assert.deepEqual(
      await npm.locator(".matrix__cell").evaluateAll((cells) => cells.map((c) => c.className.replace("matrix__cell matrix__cell--", ""))),
      ["set", "inherited", "inherited", "missing"],
    );
    await npm.getByText("3 / 4").waitFor();
    // API_URL は Environment にだけあり、リポジトリ単位には無い
    const api = table.locator("tr", { hasText: "API_URL" });
    assert.deepEqual(
      await api.locator(".matrix__cell").evaluateAll((cells) => cells.map((c) => c.className.replace("matrix__cell matrix__cell--", ""))),
      ["missing", "set", "set", "missing"],
    );
    assert.match((await api.locator(".matrix__cell").nth(2).getAttribute("title")) ?? "", /staging\.acme-labs\.example/);
    await page.screenshot({ path: path.join(OUT, "06g-secrets-matrix.png") });

    await page.getByRole("radio", { name: "Variables" }).click();
    assert.equal(await table.locator("tbody tr:not(.group-row)").count(), 2);
    await page.getByPlaceholder("Secret or variable name").fill("node");
    assert.equal(await table.locator("tbody tr:not(.group-row)").count(), 1);
    await page.getByPlaceholder("Secret or variable name").fill("");
    await page.getByRole("radio", { name: "All" }).click();
    await page.getByLabel("Only names with gaps").check();
    assert.equal(await table.locator("tbody tr:not(.group-row)").count(), 6);
    await page.getByLabel("Only names with gaps").uncheck();

    // 一覧と同じ取得結果を使うので、比較表に切り替えても呼び出さない。一覧に戻しても表示はそのまま
    const requests = log.slice(before).filter((l) => /\/(actions\/(secrets|variables)|environments)/.test(l));
    assert.deepEqual(requests, []);
    await page.getByRole("link", { name: /^Secrets & Variables/ }).hover();
    await page.locator(".tab-menu__list").getByRole("link", { name: "List" }).click();
    await page.mouse.move(200, 800);
    await page.locator("table.table--secrets").getByText("DEPLOY_KEY").waitFor();
  });

  await step("Labels: リポジトリごとのラベルを並べ、違いと無いところを示す（アーカイブ済みと読めないリポジトリは列にしない）", async () => {
    const before = log.length;
    await page.getByRole("link", { name: /^Labels/ }).click();
    const table = page.locator("table.table--labels");
    await table.locator(".label-pill", { hasText: "priority: high" }).waitFor();
    await page.getByText("5 labels").waitFor();
    assert.deepEqual(await table.locator("thead .labels__repo").allInnerTexts(), [
      "acme-labs/data-pipeline", "acme-labs/mobile-app", "acme-labs/web-console", "octo-dev/dotfiles", "octo-dev/tile-game",
    ]);
    assert.equal(await table.locator("tbody tr").count(), 5);
    await page.getByText("1 repository could not be read").waitFor();
    // bug: 基準はいちばん多い値（bug・d73a4a・説明あり）。mobile-app は説明が無く、web-console は名前と色が違い、dotfiles には無い
    const bug = table.locator("tbody tr").filter({ has: page.locator(".label-pill", { hasText: /^bug$/ }) });
    const states = () => bug.locator("td").evaluateAll((cells) => cells.map((c) => c.className.match(/labels__cell--(\w+)/)[1]));
    assert.deepEqual(await states(), ["same", "differs", "differs", "missing", "same"]);
    await bug.locator("td").nth(2).getByText("name, color").waitFor();
    // 読むだけでは書き込まない
    assert.deepEqual(control.labelWrites, []);
    assert.ok(log.slice(before).every((l) => l.startsWith("GET ")));
    await page.screenshot({ path: path.join(OUT, "06h-labels.png") });
  });

  await step("Labels: 選んだラベルの変更の予定を確かめてから送り、送ったリポジトリだけ取り直す", async () => {
    const table = page.locator("table.table--labels");
    const bug = table.locator("tbody tr").filter({ has: page.locator(".label-pill", { hasText: /^bug$/i }) }).first();
    await bug.getByRole("checkbox").check();
    // 対象のリポジトリは、最初はどれも入っていないので何も送らない
    await page.getByText("Check the target repositories.").waitFor();
    assert.equal(await page.getByRole("button", { name: "No changes" }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Delete", exact: true }).isDisabled(), true);
    await page.getByLabel("Target octo-dev/dotfiles").check();
    await page.getByRole("button", { name: "Review 1 change" }).waitFor();
    await page.getByLabel("All repositories").check();
    await page.getByText("Targets: 5 of 5 repositories").waitFor();
    await page.getByRole("button", { name: "Review 3 changes" }).waitFor();
    // 追加をやめると、追加の分が予定から外れる
    await page.getByLabel("Add missing labels").uncheck();
    await page.getByRole("button", { name: "Review 2 changes" }).waitFor();
    await page.getByLabel("Add missing labels").check();
    // web-console の値を基準にすると、ほかの 3 つを変えることになる。もう一度押すと元に戻る
    await bug.locator("td").nth(2).getByRole("button").click();
    await page.getByRole("button", { name: "Review 4 changes" }).waitFor();
    await bug.locator("td").nth(2).getByRole("button").click();
    await page.getByRole("button", { name: "Review 3 changes" }).waitFor();

    // type: bug を bug へ: web-console にはすでに Bug があるので、送らずに飛ばす
    const typeBug = table.locator("tbody tr").filter({ has: page.locator(".label-pill", { hasText: "type: bug" }) });
    await typeBug.getByRole("button", { name: "Rename" }).click();
    await typeBug.getByLabel("New name").fill("bug");
    await typeBug.getByRole("button", { name: "OK" }).click();
    await typeBug.getByText("→").waitFor();
    await typeBug.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Review 3 changes" }).click();
    const plan = page.locator(".labels__plan li");
    assert.deepEqual(await plan.allInnerTexts(), [
      "Change description of bug in acme-labs/mobile-app",
      "Change name, color of Bug in acme-labs/web-console",
      "Add bug to octo-dev/dotfiles",
      "Skip acme-labs/web-console: it already has bug, so type: bug is not renamed",
    ]);
    await page.screenshot({ path: path.join(OUT, "06i-labels-confirm.png") });
    assert.deepEqual(control.labelWrites, []);

    const before = log.length;
    await page.getByRole("button", { name: "Apply 3 changes" }).click();
    await page.getByText("Applied 3 changes.").waitFor();
    assert.deepEqual(control.labelWrites, [
      `PATCH acme-labs/mobile-app bug {"new_name":"bug","color":"d73a4a","description":"Something isn't working"}`,
      `PATCH acme-labs/web-console Bug {"new_name":"bug","color":"d73a4a","description":"Something isn't working"}`,
      `POST octo-dev/dotfiles {"name":"bug","color":"d73a4a","description":"Something isn't working"}`,
    ]);
    // 変えた 3 リポジトリだけ取り直す
    await page.getByText("4 labels").waitFor();
    const reads = log.slice(before).filter((l) => l.startsWith("GET ") && l.includes("/labels"));
    assert.deepEqual(reads.map((l) => l.split("?")[0]).sort(), [
      "GET /repos/acme-labs/mobile-app/labels", "GET /repos/acme-labs/web-console/labels", "GET /repos/octo-dev/dotfiles/labels",
    ]);
    // そろった bug は「違いのあるラベルだけ」では出ない
    assert.equal(await table.locator(".label-pill", { hasText: /^bug$/ }).count(), 0);
    await page.getByRole("button", { name: "Close" }).click();
  });

  await step("Labels: まだ無い名前へ変える。送れなかったら必要な権限を示す", async () => {
    const table = page.locator("table.table--labels");
    const typeBug = table.locator("tbody tr").filter({ has: page.locator(".label-pill", { hasText: "type: bug" }) });
    await typeBug.getByRole("button", { name: "Rename" }).click();
    await typeBug.getByLabel("New name").fill("   ");
    await typeBug.getByRole("button", { name: "OK" }).click();
    await typeBug.getByText("Enter a name.").waitFor();
    await typeBug.getByLabel("New name").fill("kind: bug");
    await typeBug.getByRole("button", { name: "OK" }).click();
    await typeBug.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Review 1 change" }).click();
    assert.deepEqual(await page.locator(".labels__plan li").allInnerTexts(), ["Rename type: bug to kind: bug in acme-labs/web-console"]);
    await page.getByRole("button", { name: "Apply 1 change" }).click();
    await page.getByText("Applied 1 change.").waitFor();
    assert.equal(control.labelWrites.at(-1), `PATCH acme-labs/web-console type: bug {"new_name":"kind: bug","color":"d73a4a","description":"Bug reports"}`);
    await table.locator(".label-pill", { hasText: "kind: bug" }).waitFor();
    await page.getByRole("button", { name: "Close" }).click();

    control.failLabelWrites = true;
    const good = table.locator("tbody tr").filter({ has: page.locator(".label-pill", { hasText: "good first issue" }) });
    await good.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Review 4 changes" }).click();
    await page.getByRole("button", { name: "Apply 4 changes" }).click();
    await page.getByText(/^4 of 4 changes failed\./).waitFor();
    await page.locator(".permission-hint li", { hasText: "Issues: Read and write" }).waitFor();
    await page.screenshot({ path: path.join(OUT, "06j-labels-failed.png") });
    control.failLabelWrites = false;
    await page.getByRole("button", { name: "Close" }).click();
  });

  await step("Labels: 削除は 2 段階の確認（元に戻せないこと → delete と入力）を経て、対象のリポジトリにあるものだけを消す", async () => {
    const table = page.locator("table.table--labels");
    const rowOf = (name) => table.locator("tbody tr").filter({ has: page.locator(".label-pill", { hasText: name }) });
    // 対象は data-pipeline と tile-game だけ
    await page.getByLabel("All repositories").uncheck();
    await page.getByLabel("Target acme-labs/data-pipeline").check();
    await page.getByLabel("Target octo-dev/tile-game").check();
    for (const name of ["enhancement", "good first issue", "priority: high"]) await rowOf(name).getByRole("checkbox").check();
    const writes = control.labelWrites.length;

    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByText("Delete 4 labels from 2 repositories.").waitFor();
    await page.getByText(/^Deleting a label removes it from every issue and pull request it is on\./).waitFor();
    assert.deepEqual(await page.locator(".labels__plan li").evaluateAll((li) => li.map((l) => l.firstChild.textContent.trim())), [
      "enhancement in acme-labs/data-pipeline",
      "enhancement in octo-dev/tile-game",
      "good first issue in octo-dev/tile-game",
      "priority: high in acme-labs/data-pipeline",
    ]);
    const link = page.locator(".labels__plan li a").first();
    assert.equal(await link.getAttribute("href"), `https://github.com/search?type=issues&q=${encodeURIComponent('repo:acme-labs/data-pipeline label:"enhancement"')}`);
    await page.screenshot({ path: path.join(OUT, "06k-labels-delete-warn.png") });
    // 1 段目で取りやめると何も消さず、選択は残る
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByText("3 labels selected").waitFor();
    assert.equal(control.labelWrites.length, writes);

    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "I understand" }).click();
    await page.getByText("Are you sure?").waitFor();
    await page.getByText("This cannot be undone. Type delete to continue.").waitFor();
    const confirm = page.getByRole("button", { name: "Delete 4 labels" });
    assert.equal(await confirm.isDisabled(), true);
    await page.getByLabel("Type delete to continue.").fill("Delete");
    assert.equal(await confirm.isDisabled(), true);
    await page.getByLabel("Type delete to continue.").press("Enter");
    assert.equal(control.labelWrites.length, writes);
    await page.getByLabel("Type delete to continue.").fill("delete");
    await page.screenshot({ path: path.join(OUT, "06l-labels-delete-confirm.png") });
    await confirm.click();
    await page.getByText("Deleted 4 labels.").waitFor();
    assert.deepEqual(control.labelWrites.slice(writes), [
      "DELETE acme-labs/data-pipeline enhancement {}",
      "DELETE octo-dev/tile-game enhancement {}",
      "DELETE octo-dev/tile-game good first issue {}",
      "DELETE acme-labs/data-pipeline priority: high {}",
    ]);
    // 対象でなかったリポジトリの enhancement は残る
    assert.deepEqual(control.labels["acme-labs/web-console"].map((l) => l.name).sort(), ["bug", "enhancement", "kind: bug"]);
    await rowOf("good first issue").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Close" }).click();
  });

  await step("Labels: 削除できなかったものは、残っているラベルと必要な権限を示す", async () => {
    const table = page.locator("table.table--labels");
    control.failLabelWrites = true;
    await page.getByLabel("All repositories").check();
    await table.locator("tbody tr").filter({ has: page.locator(".label-pill", { hasText: "kind: bug" }) }).getByRole("checkbox").check();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "I understand" }).click();
    await page.getByLabel("Type delete to continue.").fill("delete");
    await page.getByRole("button", { name: "Delete 1 label" }).click();
    await page.getByText(/^1 of 1 labels could not be deleted\./).waitFor();
    await page.getByText("These labels are still there:").waitFor();
    await page.locator(".labels__plan li", { hasText: "kind: bug in acme-labs/web-console" }).waitFor();
    await page.locator(".permission-hint li", { hasText: "Issues: Read and write" }).waitFor();
    control.failLabelWrites = false;
    await page.getByRole("button", { name: "Close" }).click();
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
    await dialog.getByText(/The run was started on master/).waitFor();
    assert.match(await dialog.getByRole("link", { name: /Open the run on GitHub/ }).getAttribute("href"), /\/actions\/runs\/\d+$/);
    await page.screenshot({ path: path.join(OUT, "13-dispatch-done.png") });
    assert.equal(dispatches.length, 1);
    assert.deepEqual(dispatches[0].body, {
      ref: "master",
      inputs: { environment: "staging", level: "debug", dry_run: "false", replicas: "3" },
      return_run_details: true,
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

  await step("Actions: アーティファクトのパネルで、ワークフロー・実行ごとの成果物を落とせる", async () => {
    const before = log.length;
    await page.getByRole("tab", { name: "Artifacts" }).click();
    const web = page.locator(".wa-repo", { hasText: "web-console" });
    // 最近の実行にあるものは呼び出しなしで、古い実行は 1 回だけ読んでワークフローが分かる
    await web.locator(".wa-workflow", { hasText: "Deploy" }).getByText("dist-bundle").waitFor();
    await web.locator(".wa-workflow", { hasText: "CI" }).getByText("playwright-report").waitFor();
    await web.locator(".wa-workflow", { hasText: "Deploy" }).getByText(/#3 · release\/1\.9/).waitFor();
    // 実行が見つからないものは「ワークフロー不明」にまとめ、期限切れは落とせない
    const mobile = page.locator(".wa-repo", { hasText: "mobile-app" });
    await mobile.getByText("Unknown workflow").waitFor();
    await mobile.locator(".asset--expired", { hasText: "ios-simulator-build" }).getByText("Expired").waitFor();
    await page.screenshot({ path: path.join(OUT, "08b-actions-artifacts.png") });
    const runGets = log.slice(before).filter((l) => /^GET \/repos\/acme-labs\/web-console\/actions\/runs\/\d+$/.test(l));
    assert.equal(runGets.length, 1, runGets.join("\n"));
    assert.ok(runGets[0].endsWith(`/runs/${fx.archivedRunsByRepo["acme-labs/web-console"][0].id}`));
    // 何度表示し直しても、同じ実行は読み直さない
    await page.getByRole("tab", { name: "Workflows" }).click();
    await page.getByRole("tab", { name: "Artifacts" }).click();
    await web.getByText("dist-bundle").waitFor();
    assert.equal(log.slice(before).filter((l) => /^GET \/repos\/acme-labs\/web-console\/actions\/runs\/\d+$/.test(l)).length, 1);

    await web.getByRole("button", { name: "Download playwright-report" }).click();
    await page.getByText(/Started downloading playwright-report\.|Download of playwright-report failed/).waitFor();
    await downloaded(/^https:\/\/fakeresults\.blob\.core\.windows\.net\/results\/\d+\.zip\?sig=artifact$/);
    await page.getByRole("tab", { name: "Workflows" }).click();
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
      // 実行中のものがなくなったら、それ以上は問い合わせない（一覧全体の自動更新は 5 分ごとなので、その手前まで見る）
      await page.clock.fastForward("03:00");
      await page.waitForTimeout(300);
      assert.equal(runsCalls(), before + 1);
      assert.equal(log.filter((l) => l.startsWith("GET /repos/acme-labs/data-pipeline/actions/runs")).length, 1);
    });
    await context.close();
  }

  // ---- 実行したワークフローの追跡 ----------------------------------------------------
  {
    const { context, page, id, log, control } = await launch();
    await step("Actions: 実行したものは、待機中から完了まで状態を追う（自動更新がオフでも）", async () => {
      await page.clock.install();
      control.completeAllRuns();
      await connect(page, id);
      await page.goto(`chrome-extension://${id}/manager.html#actions`);
      const row = page.locator("tr", { has: page.getByRole("link", { name: "Deploy", exact: true }) });
      await row.getByText("Failure").waitFor();
      await page.getByRole("switch", { name: "Auto refresh" }).click();
      // 作られた直後は 1 回だけ見えない（GitHub 側の反映の遅れ）
      control.hideRunGets = 1;

      await page.getByRole("button", { name: "Run Deploy" }).click();
      const dialog = page.locator("dialog[open]");
      await dialog.getByLabel(/^environment/).selectOption("staging");
      await dialog.getByLabel(/^replicas/).fill("3");
      await dialog.getByRole("button", { name: "Review" }).click();
      await dialog.getByRole("button", { name: "Run workflow" }).click();
      await dialog.getByText(/The run was started on master/).waitFor();
      await dialog.getByRole("button", { name: "Close" }).click();
      const run = control.dispatchedRuns[0];
      const runGets = () => log.filter((l) => l === `GET /repos/acme-labs/web-console/actions/runs/${run.id}`).length;
      await page.waitForTimeout(300);
      assert.equal(runGets(), 1, "依頼した直後に 1 回問い合わせる（まだ見えない）");
      await row.getByText("Failure").waitFor();

      await page.clock.fastForward("00:59");
      await page.waitForTimeout(300);
      assert.equal(runGets(), 1, "1 分たつまでは問い合わせない");
      await page.clock.fastForward("00:02");
      await row.getByText("Queued").waitFor();
      run.status = "in_progress";
      await page.clock.fastForward("01:00");
      await row.getByText("In progress").waitFor();
      Object.assign(run, { status: "completed", conclusion: "success" });
      await page.clock.fastForward("01:00");
      await row.getByText("Success").waitFor();
      const done = runGets();
      // 完了したら追うのをやめる。一覧全体の取り直しもしない（自動更新はオフ）
      const before = log.length;
      await page.clock.fastForward("10:00");
      await page.waitForTimeout(300);
      assert.equal(runGets(), done);
      assert.deepEqual(log.slice(before), []);
    });
    await context.close();
  }

  // ---- 自動更新 -------------------------------------------------------------------
  {
    const { context, page, id, log, control } = await launch();
    await step("自動更新: List は 1 分ごと、Kanban は 2 分ごとに、表示を消さずに取り直す", async () => {
      await page.clock.install();
      await connect(page, id);
      await page.goto(`chrome-extension://${id}/manager.html#issues`);
      await page.getByRole("link", { name: "Billing page crashes when the invoice list is empty" }).waitFor();
      assert.equal(await page.getByRole("switch", { name: "Auto refresh" }).getAttribute("aria-checked"), "true");
      const searches = () => log.filter((l) => l.startsWith("GET /search/issues")).length;
      const before = searches();
      const created = { ...control.issues["acme-labs"][0], id: 6001, number: 430, title: "Created on GitHub a moment ago", html_url: "https://github.com/acme-labs/web-console/issues/430" };
      control.issues["acme-labs"].unshift(created);
      await page.clock.fastForward("00:59");
      await page.waitForTimeout(300);
      assert.equal(searches(), before, "1 分たつまでは取り直さない");
      await page.clock.fastForward("00:02");
      await page.getByRole("link", { name: "Created on GitHub a moment ago" }).waitFor();
      // 選んでいる 3 所有者を 1 回ずつ検索し直す（読めなかった所有者も、権限が直っていれば表示できるように含める）
      assert.equal(searches(), before + 3);

      await page.getByRole("link", { name: /^Issues/ }).hover();
      await page.locator(".tab-menu__list").getByRole("link", { name: "Kanban" }).click();
      await page.getByRole("link", { name: "Billing page crashes when the invoice list is empty" }).waitFor();
      await page.locator(".card", { hasText: "Billing page crashes" }).evaluate((el) => (el.dataset.mark = "kept"));
      control.projectItems["acme-labs/1"].push({ ...control.projectItems["acme-labs/1"][0], id: 9100, content: created, status: "doing" });
      await page.clock.fastForward("01:59");
      await page.waitForTimeout(300);
      assert.equal(await page.getByText("Created on GitHub a moment ago").count(), 0, "2 分たつまでは取り直さない");
      await page.clock.fastForward("00:02");
      await page.locator(".board", { hasText: "Platform roadmap" }).getByRole("group", { name: "In progress", exact: true }).getByText("Created on GitHub a moment ago").waitFor();
      // 変わっていないカードは作り直さない
      assert.equal(await page.locator('.card[data-mark="kept"]').count(), 1);
    });

    await step("自動更新: アーティファクトはリポジトリの数から決めた間隔で取り直し、削除の確認中は取り直さない", async () => {
      await page.getByRole("link", { name: /^Artifacts/ }).click();
      await page.locator("td.cell-name", { hasText: "parquet-sample-export" }).waitFor();
      // 6 リポジトリなら 1 回 6 回の呼び出しで、最短の 5 分ごと
      assert.equal(await page.getByRole("switch", { name: "Auto refresh" }).getAttribute("title"), "Refresh every 5 minutes while this screen is open");
      const list = control.artifacts["acme-labs/web-console"];
      list.unshift({ ...list[0], id: 7777, name: "nightly-e2e-bundle" });
      await page.clock.fastForward("04:58");
      await page.waitForTimeout(300);
      assert.equal(await page.locator("td.cell-name", { hasText: "nightly-e2e-bundle" }).count(), 0);
      await page.clock.fastForward("00:04");
      await page.locator("td.cell-name", { hasText: "nightly-e2e-bundle" }).waitFor();

      await page.getByRole("button", { name: /Select 3 older than 30 days/ }).click();
      await page.getByRole("button", { name: "Delete 3" }).click();
      list.unshift({ ...list[0], id: 7778, name: "while-confirming" });
      await page.clock.fastForward("05:01");
      await page.waitForTimeout(300);
      assert.equal(await page.locator("td.cell-name", { hasText: "while-confirming" }).count(), 0, "確認中は取り直さない");
      await page.getByRole("button", { name: "Cancel" }).click();
      await page.clock.fastForward("05:01");
      await page.locator("td.cell-name", { hasText: "while-confirming" }).waitFor();
    });

    await step("自動更新: オフにすると取り直さず、オフのままになる", async () => {
      await page.getByRole("switch", { name: "Auto refresh" }).click();
      assert.equal(await page.getByRole("switch", { name: "Auto refresh" }).getAttribute("aria-checked"), "false");
      const before = log.length;
      await page.clock.fastForward("05:00");
      await page.waitForTimeout(300);
      assert.deepEqual(log.slice(before), []);
      // 再読み込みボタンは、オフでもいつでも使える
      await page.getByRole("button", { name: "Refresh" }).click();
      await page.waitForFunction(() => !document.querySelector(".row--skeleton"));
      assert.ok(log.slice(before).some((l) => l.includes("/actions/artifacts")));
      await page.reload();
      await page.locator("td.cell-name", { hasText: "parquet-sample-export" }).waitFor();
      assert.equal(await page.getByRole("switch", { name: "Auto refresh" }).getAttribute("aria-checked"), "false");
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

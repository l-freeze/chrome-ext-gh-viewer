// E2E と画面撮影で共通の準備: 拡張機能を読み込んだ Chromium と、偽の GitHub。
const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const fx = require("./fixtures.cjs");

const DEFAULT_EXT = path.resolve(__dirname, "../.output/chrome-mv3");

const strip = ({ _type, ...r }) => r;
const json = (route, body, status = 200, headers = {}) =>
  route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });

/**
 * @param {string[]} log 受けたリクエストを記録する
 * @param {{ delayMs?: number }} options delayMs: アーティファクト一覧の応答を遅らせる（読み込み中の画面用）
 */
function api(log, { delayMs = 0, dispatches = [], deletes = [], control } = {}) {
  const artifacts = control.artifacts;
  return async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    log.push(`${req.method()} ${p}${url.search}`);
    const token = req.headers()["authorization"]?.replace(/^Bearer /, "") ?? "";
    if (!token || token.includes("revoked")) return json(route, { message: "Bad credentials" }, 401);
    if (p === "/user") {
      // トークンの種類で応答ヘッダーを変える（Fine-grained にはスコープのヘッダーがない）
      if (token.startsWith("github_pat_"))
        return json(route, fx.viewer, 200, { "github-authentication-token-expiration": "2026-12-15 00:00:00 UTC" });
      if (token.includes("narrow")) return json(route, fx.viewer, 200, { "x-oauth-scopes": "public_repo" });
      return json(route, fx.viewer, 200, {
        "x-oauth-scopes": "repo, read:org, project",
        ...(token.startsWith("ghp_") ? { "github-authentication-token-expiration": "2027-01-31 00:00:00 UTC" } : {}),
      });
    }
    if (p === "/user/orgs") return json(route, fx.orgs.map((o) => ({ ...o, type: undefined })));
    if (p === "/user/repos") return json(route, fx.repos.map(strip));
    let m = /^\/repos\/([^/]+)\/([^/]+)\/actions\/artifacts$/.exec(p);
    if (m) {
      const key = `${m[1]}/${m[2]}`;
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs * (1 + Object.keys(artifacts).indexOf(key))));
      if (key === "locked-corp/secret-service")
        return json(route, { message: "Resource protected by organization SAML enforcement." }, 403, {
          "x-github-sso": "required; url=https://github.com/orgs/locked-corp/sso?authorization_request=fake",
        });
      const list = artifacts[key] ?? [];
      return json(route, { total_count: list.length, artifacts: list });
    }
    m = /^\/repos\/([^/]+)\/([^/]+)\/actions\/artifacts\/(\d+)(\/zip)?$/.exec(p);
    if (m) {
      const key = `${m[1]}/${m[2]}`;
      if (req.method() === "DELETE") {
        artifacts[key] = (artifacts[key] ?? []).filter((a) => a.id !== Number(m[3]));
        return route.fulfill({ status: 204 });
      }
    }
    m = /^\/repos\/([^/]+)\/([^/]+)\/actions\/caches(?:\/(\d+))?$/.exec(p);
    if (m) {
      const key = `${m[1]}/${m[2]}`;
      if (key === "locked-corp/secret-service") return json(route, { message: "Forbidden" }, 403);
      if (req.method() === "DELETE") {
        control.caches[key] = (control.caches[key] ?? []).filter((c) => c.id !== Number(m[3]));
        deletes.push(`cache ${m[3]}`);
        return route.fulfill({ status: 204 });
      }
      const list = control.caches[key] ?? [];
      return json(route, { total_count: list.length, actions_caches: list });
    }
    m = /^\/repos\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)$/.exec(p);
    if (m && req.method() === "GET") {
      // 作られた直後の実行がまだ見えない様子を再現する（hideRunGets 回だけ 404）
      if (control.hideRunGets > 0) {
        control.hideRunGets--;
        return json(route, { message: "Not Found" }, 404);
      }
      const run = (control.runs[`${m[1]}/${m[2]}`] ?? []).find((r) => r.id === Number(m[3]));
      return run ? json(route, run) : json(route, { message: "Not Found" }, 404);
    }
    if (m && req.method() === "DELETE") {
      const key = `${m[1]}/${m[2]}`;
      control.oldRuns[key] = (control.oldRuns[key] ?? []).filter((r) => r.id !== Number(m[3]));
      deletes.push(`run ${m[3]}`);
      return route.fulfill({ status: 204 });
    }
    m = /^\/repos\/([^/]+)\/([^/]+)\/releases$/.exec(p);
    if (m) {
      const key = `${m[1]}/${m[2]}`;
      if (key === "locked-corp/secret-service") return json(route, { message: "Forbidden" }, 403);
      return json(route, fx.releasesByRepo[key] ?? []);
    }
    m = /^\/repos\/([^/]+)\/([^/]+)\/(?:environments\/([^/]+)|actions)\/(secrets|variables)$/.exec(p);
    if (m) {
      const key = `${m[1]}/${m[2]}`;
      if (key === "locked-corp/secret-service")
        return json(route, { message: "Resource not accessible by personal access token" }, 403, { "x-accepted-github-permissions": `${m[4]}=read` });
      const config = fx.configByRepo[key];
      const scope = m[3] === undefined ? config : config?.environments[decodeURIComponent(m[3])];
      const list = scope?.[m[4]] ?? [];
      return json(route, { total_count: list.length, [m[4]]: list });
    }
    m = /^\/repos\/([^/]+)\/([^/]+)\/(actions\/workflows|actions\/runs|branches|environments)$/.exec(p);
    if (m) {
      const key = `${m[1]}/${m[2]}`;
      if (key === "locked-corp/secret-service") return json(route, { message: "Forbidden" }, 403);
      if (m[3] === "actions/workflows") {
        const list = fx.workflowsByRepo[key] ?? [];
        return json(route, { total_count: list.length, workflows: list });
      }
      if (m[3] === "actions/runs") {
        const created = url.searchParams.get("created");
        if (created) {
          // 実行履歴の整理の検索: created=<YYYY-MM-DD と status で絞る
          const before = Date.parse(`${created.slice(1)}T00:00:00Z`);
          const status = url.searchParams.get("status");
          const list = (control.oldRuns[key] ?? []).filter(
            (r) => Date.parse(r.created_at) < before && (status === "completed" || r.conclusion === status),
          );
          const page = Number(url.searchParams.get("page") ?? "1");
          const items = list.slice((page - 1) * 100, page * 100);
          const headers = page * 100 < list.length ? { link: `<https://api.github.com${p}?created=${encodeURIComponent(created)}&status=${status}&per_page=100&page=${page + 1}>; rel="next"` } : {};
          return json(route, { total_count: list.length, workflow_runs: items }, 200, headers);
        }
        const list = control.runs[key] ?? [];
        return json(route, { total_count: list.length, workflow_runs: list });
      }
      if (m[3] === "branches") return json(route, [{ name: "master" }, { name: "legacy" }].map((b) => ({ ...b, commit: {}, protected: false })));
      return json(route, { total_count: 2, environments: [{ id: 1, name: "staging" }, { id: 2, name: "production" }] });
    }
    m = /^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/.exec(p);
    if (m) {
      // legacy ブランチには手動実行のトリガーがない想定
      if (url.searchParams.get("ref") === "legacy") return route.fulfill({ status: 200, body: "on: push\njobs: {}\n" });
      // Contents の権限がないトークンを想定（GitHub は必要な権限をヘッダーで返す）
      if (m[3].endsWith("export.yml"))
        return json(route, { message: "Resource not accessible by personal access token" }, 403, {
          "x-accepted-github-permissions": "contents=read",
          "x-accepted-oauth-scopes": "repo",
        });
      const text = fx.workflowYaml[decodeURIComponent(m[3])];
      return text ? route.fulfill({ status: 200, contentType: "text/plain", body: text }) : json(route, { message: "Not Found" }, 404);
    }
    m = /^\/repos\/([^/]+)\/([^/]+)\/actions\/workflows\/(\d+)\/dispatches$/.exec(p);
    if (m && req.method() === "POST") {
      const key = `${m[1]}/${m[2]}`;
      const body = JSON.parse(req.postData() ?? "{}");
      dispatches.push({ repo: key, workflowId: Number(m[3]), body });
      // GitHub と同じく、受け付けた実行を待機中として作る
      const id = control.nextRunId++;
      const run = {
        id, workflow_id: Number(m[3]), run_number: id - 90000, status: "queued", conclusion: null, event: "workflow_dispatch",
        head_branch: body.ref, actor: fx.viewer, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        html_url: `https://github.com/${key}/actions/runs/${id}`,
      };
      (control.runs[key] ??= []).unshift(run);
      control.dispatchedRuns.push(run);
      if (!body.return_run_details) return route.fulfill({ status: 204 });
      return json(route, { workflow_run_id: id, run_url: `https://api.github.com/repos/${key}/actions/runs/${id}`, html_url: run.html_url });
    }
    m = /^\/(orgs|users)\/([^/]+)\/projectsV2(?:\/(\d+)(?:\/(fields|items)(?:\/(\d+))?)?)?$/.exec(p);
    if (m) {
      const [, , owner, number, part, itemIdText] = m;
      if (owner === "locked-corp")
        return json(route, { message: "Your token has not been granted the required scopes to execute this query." }, 403, { "x-accepted-oauth-scopes": "read:project" });
      if (!number) return json(route, fx.projectsByOwner[owner] ?? []);
      const key = `${owner}/${number}`;
      const field = fx.statusFieldByProject[key];
      if (part === "fields") return json(route, [{ id: 300, name: "Title", data_type: "title" }, ...(field ? [field] : [])]);
      const items = control.projectItems[key] ?? [];
      if (part === "items" && !itemIdText) {
        const fields = (url.searchParams.get("fields") ?? "").split(",").filter(Boolean).map(Number);
        return json(route, items.map(({ status, ...i }) => ({
          ...i,
          fields: field && fields.includes(field.id)
            ? [{ id: field.id, name: field.name, data_type: "single_select", value: field.options.find((o) => o.id === status) ?? null }]
            : [],
        })));
      }
      if (part === "items" && req.method() === "PATCH") {
        const body = JSON.parse(req.postData() ?? "{}");
        control.patches.push({ project: key, item: Number(itemIdText), body });
        if (control.failMoves)
          return json(route, { message: "Resource not accessible by personal access token" }, 403, { "x-accepted-github-permissions": "organization_projects=write" });
        const target = items.find((i) => i.id === Number(itemIdText));
        if (target) target.status = body.fields[0].value;
        return json(route, target ?? {});
      }
    }
    if (p === "/search/issues") {
      const q = url.searchParams.get("q");
      const owner = /(?:org|user):(\S+)/.exec(q)[1];
      if (owner === "locked-corp") return json(route, { message: "forbidden" }, 403);
      const state = /is:(open|closed)/.exec(q)?.[1];
      const items = (control.issues[owner] ?? []).filter((i) => !state || i.state === state);
      return json(route, { total_count: items.length, incomplete_results: false, items });
    }
    return json(route, { message: "Not Found" }, 404);
  };
}

function oauth(log) {
  let polls = 0;
  return async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    log.push(`${req.method()} github.com${url.pathname}`);
    if (url.pathname === "/login/device/code")
      return json(route, {
        device_code: "dev-fake",
        user_code: "WXYZ-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 1,
      });
    if (url.pathname === "/login/oauth/access_token")
      return json(route, polls++ === 0 ? { error: "authorization_pending" } : { access_token: "gho_e2e_fake", token_type: "bearer", scope: "repo,read:org,project" });
    return route.fulfill({ status: 404 });
  };
}

async function launch({ colorScheme = "light", locale = "en-US", viewport = { width: 1440, height: 900 }, ext = DEFAULT_EXT, delayMs = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-profile-"));
  const context = await chromium.launchPersistentContext(dir, {
    headless: true,
    channel: "chromium",
    colorScheme,
    locale,
    viewport,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--lang=${locale}`],
  });
  const log = [];
  const dispatches = [];
  // テストから偽 API の状態を変えるためのつまみ
  const deletes = [];
  const control = {
    runs: structuredClone(fx.runsByRepo),
    oldRuns: structuredClone(fx.oldRunsByRepo),
    caches: structuredClone(fx.cachesByRepo),
    artifacts: structuredClone(fx.artifactsByRepo),
    issues: structuredClone(fx.issuesByOwner),
    projectItems: structuredClone(fx.projectItems),
    patches: [],
    nextRunId: 90001,
    dispatchedRuns: [],
    hideRunGets: 0,
    failMoves: false,
    completeAllRuns() {
      for (const list of Object.values(this.runs))
        for (const run of list) if (run.status !== "completed") Object.assign(run, { status: "completed", conclusion: "success" });
    },
  };
  await context.route("https://api.github.com/**", api(log, { delayMs, dispatches, deletes, control }));
  await context.route("https://github.com/login/**", oauth(log));
  await context.route("https://avatars.githubusercontent.com/**", (r) => r.fulfill({ status: 404 }));
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker");
  const id = new URL(sw.url()).host;
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // 偽 API の 403/404 による読み込みエラーは想定どおりなので除く
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(m.text()));
  return { context, page, id, log, errors, dispatches, control, deletes };
}

module.exports = { launch };

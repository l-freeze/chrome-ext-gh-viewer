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
function api(log, { delayMs = 0 } = {}) {
  const artifacts = structuredClone(fx.artifactsByRepo);
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
        "x-oauth-scopes": "repo, read:org",
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
    if (p === "/search/issues") {
      const q = url.searchParams.get("q");
      const owner = /(?:org|user):(\S+)/.exec(q)[1];
      if (owner === "locked-corp") return json(route, { message: "forbidden" }, 403);
      const state = /is:(open|closed)/.exec(q)?.[1];
      const items = (fx.issuesByOwner[owner] ?? []).filter((i) => !state || i.state === state);
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
      return json(route, polls++ === 0 ? { error: "authorization_pending" } : { access_token: "gho_e2e_fake", token_type: "bearer", scope: "repo,read:org" });
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
  await context.route("https://api.github.com/**", api(log, { delayMs }));
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
  return { context, page, id, log, errors };
}

module.exports = { launch };

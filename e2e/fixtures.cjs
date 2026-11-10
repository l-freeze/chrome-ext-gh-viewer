// E2E 用の偽 GitHub API。実在しない名前だけを使う。
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const iso = (daysAgo) => new Date(now - daysAgo * DAY).toISOString();

const user = (login, type = "User", id = 1) => ({
  login, id, type, avatar_url: `https://avatars.githubusercontent.com/u/${id}`, html_url: `https://github.com/${login}`,
});
const viewer = user("octo-dev", "User", 1);
const orgs = [user("acme-labs", "Organization", 2), user("locked-corp", "Organization", 3)];

const repo = (owner, name, id, ownerType = "Organization") => ({
  id, name, full_name: `${owner.login}/${name}`, owner, private: true, archived: false,
  html_url: `https://github.com/${owner.login}/${name}`, pushed_at: iso(1), default_branch: "master", _type: ownerType,
});
const repos = [
  repo(orgs[0], "data-pipeline", 11),
  repo(orgs[0], "web-console", 12),
  repo(orgs[0], "mobile-app", 13),
  repo(viewer, "dotfiles", 14),
  repo(viewer, "tile-game", 15),
  repo(orgs[1], "secret-service", 16),
];

let nextId = 1000;
const MB = 1024 * 1024;
const artifact = (name, sizeMB, ageDays, branch, { expired = false, retention = 90 } = {}) => {
  const id = nextId++;
  const expiresAt = new Date(now - ageDays * DAY + retention * DAY).toISOString();
  return {
    id, node_id: `A_${id}`, name, size_in_bytes: Math.round(sizeMB * MB),
    url: "", archive_download_url: "", expired,
    created_at: iso(ageDays), updated_at: iso(ageDays), expires_at: expiresAt, digest: null,
    workflow_run: { id: id * 10, repository_id: 1, head_repository_id: 1, head_branch: branch, head_sha: "abc" },
  };
};
const artifactsByRepo = {
  "acme-labs/data-pipeline": [
    artifact("test-results-junit", 1.2, 0, "fix/null-partition"),
    artifact("parquet-sample-export", 412.8, 46, "main"),
    artifact("dbt-docs-site", 18.9, 101, "release/2.4", { expired: true }),
  ],
  "acme-labs/web-console": [
    artifact("playwright-report", 148.6, 1, "main"),
    artifact("dist-bundle", 23.4, 2, "feat/billing-page"),
    artifact("coverage-lcov", 6.1, 89, "main"),
  ],
  "acme-labs/mobile-app": [
    artifact("android-release-apk", 96.3, 9, "release/5.2.0"),
    artifact("detox-screenshots", 54.0, 27, "main"),
    artifact("ios-simulator-build", 311.5, 92, "main", { expired: true }),
  ],
  "octo-dev/dotfiles": [artifact("nix-closure-cache", 204.0, 71, "main")],
  "octo-dev/tile-game": [
    artifact("webgl-build", 72.2, 18, "main", { retention: 30 }),
    artifact("wasm-profile-trace", 8.7, 59, "perf/atlas-packing", { expired: true, retention: 30 }),
  ],
};

const label = (name, color) => ({ id: name.length, name, color, description: null });
let issueId = 5000;
const issue = (owner, repoName, number, title, { state = "open", labels = [], assignees = [], updatedDaysAgo = 1 } = {}) => ({
  id: issueId++, number, title, state, state_reason: null,
  html_url: `https://github.com/${owner}/${repoName}/issues/${number}`,
  repository_url: `https://api.github.com/repos/${owner}/${repoName}`,
  user: user("mona-fake", "User", 99), labels, assignees, comments: number % 4,
  created_at: iso(updatedDaysAgo + 10), updated_at: iso(updatedDaysAgo), closed_at: state === "closed" ? iso(updatedDaysAgo) : null,
});
const issuesByOwner = {
  "acme-labs": [
    issue("acme-labs", "web-console", 412, "Billing page crashes when the invoice list is empty", { labels: [label("bug", "d73a4a"), label("billing", "0e8a16")], assignees: [viewer], updatedDaysAgo: 0 }),
    issue("acme-labs", "web-console", 398, "Add CSV export to the usage dashboard", { labels: [label("enhancement", "a2eeef")], updatedDaysAgo: 3 }),
    issue("acme-labs", "data-pipeline", 77, "Null partitions break the nightly parquet export", { labels: [label("bug", "d73a4a"), label("p1", "b60205")], assignees: [viewer], updatedDaysAgo: 1 }),
    issue("acme-labs", "mobile-app", 1203, "Upgrade to the new push notification SDK", { labels: [label("dependencies", "0366d6")], updatedDaysAgo: 6 }),
    issue("acme-labs", "mobile-app", 1188, "Dark mode contrast on the settings screen", { state: "closed", labels: [label("design", "fbca04")], updatedDaysAgo: 12 }),
  ],
  "octo-dev": [
    issue("octo-dev", "tile-game", 14, "Texture atlas packing leaves gaps on Safari", { labels: [label("bug", "d73a4a")], updatedDaysAgo: 2 }),
    issue("octo-dev", "dotfiles", 3, "Move shell aliases into a separate module", { updatedDaysAgo: 30 }),
  ],
};

let wfId = 700;
const workflow = (repoKey, name, file, state = "active") => ({
  id: wfId++, node_id: `W_${wfId}`, name, path: `.github/workflows/${file}`, state,
  created_at: iso(300), updated_at: iso(30), url: "", badge_url: "",
  html_url: `https://github.com/${repoKey}/actions/workflows/${file}`,
});
const workflowsByRepo = {
  "acme-labs/web-console": [
    workflow("acme-labs/web-console", "CI", "ci.yml"),
    workflow("acme-labs/web-console", "Deploy", "deploy.yml"),
    workflow("acme-labs/web-console", "Nightly cleanup", "nightly.yml", "disabled_manually"),
  ],
  "acme-labs/data-pipeline": [workflow("acme-labs/data-pipeline", "Nightly export", "export.yml")],
  "octo-dev/tile-game": [workflow("octo-dev/tile-game", "Release", "release.yml")],
};
let runId = 9000;
const run = (repoKey, wf, ageDays, status, conclusion, branch = "master", event = "push") => ({
  id: runId++, workflow_id: wf.id, run_number: runId - 8990, status, conclusion, event, head_branch: branch,
  actor: user("mona-fake", "User", 99), created_at: iso(ageDays), updated_at: iso(ageDays),
  html_url: `https://github.com/${repoKey}/actions/runs/${runId}`,
});
const [ci, deploy] = workflowsByRepo["acme-labs/web-console"];
// 最近の実行履歴（1 ページ分）には出ない古い実行。実行を 1 件読む API だけが返す
const archivedRunsByRepo = {
  "acme-labs/web-console": [{ ...run("acme-labs/web-console", deploy, 89, "completed", "success", "release/1.9"), run_number: 3 }],
};
const runsByRepo = {
  "acme-labs/web-console": [
    run("acme-labs/web-console", ci, 0, "in_progress", null, "feat/billing-page"),
    run("acme-labs/web-console", ci, 1, "completed", "success"),
    run("acme-labs/web-console", deploy, 3, "completed", "failure", "master", "workflow_dispatch"),
  ],
  "acme-labs/data-pipeline": [run("acme-labs/data-pipeline", workflowsByRepo["acme-labs/data-pipeline"][0], 1, "completed", "success")],
};
// アーティファクトを、作った実行に結びつける（Actions のタブのアーティファクトのパネル用）。
// 結びつけないものは、どの実行でもない ID のまま（ワークフロー不明になる）
{
  // coverage-lcov は E2E の途中で削除される
  const ciDone = runsByRepo["acme-labs/web-console"][1];
  const byName = Object.fromEntries(artifactsByRepo["acme-labs/web-console"].map((a) => [a.name, a]));
  byName["playwright-report"].workflow_run.id = ciDone.id;
  byName["dist-bundle"].workflow_run.id = archivedRunsByRepo["acme-labs/web-console"][0].id;
}

const workflowYaml = {
  ".github/workflows/ci.yml": "name: CI\non:\n  push:\n  pull_request:\njobs: {}\n",
  ".github/workflows/deploy.yml": [
    "name: Deploy",
    "on:",
    "  workflow_dispatch:",
    "    inputs:",
    "      environment:",
    "        description: Where to deploy",
    "        type: environment",
    "        required: true",
    "      level:",
    "        description: Log level",
    "        type: choice",
    "        options: [info, debug, trace]",
    "      dry_run:",
    "        description: Only print what would change",
    "        type: boolean",
    "        default: true",
    "      replicas:",
    "        type: number",
    "        default: 2",
    "      note:",
    "        description: Shown in the run summary",
    "jobs: {}",
  ].join("\n"),
  ".github/workflows/export.yml": "on:\n  schedule:\n    - cron: '0 3 * * *'\n  workflow_dispatch:\njobs: {}\n",
  ".github/workflows/release.yml": "on: workflow_dispatch\njobs: {}\n",
};

let cacheId = 3000;
const cache = (ref, key, sizeMB, usedDaysAgo) => ({
  id: cacheId++, ref, key, version: "v1", size_in_bytes: Math.round(sizeMB * MB),
  last_accessed_at: iso(usedDaysAgo), created_at: iso(usedDaysAgo + 3),
});
const cachesByRepo = {
  "acme-labs/web-console": [
    cache("refs/heads/main", "Linux-node-modules-8c1f", 412.5, 0),
    cache("refs/pull/412/merge", "Linux-node-modules-2a9e", 398.1, 1),
    cache("refs/pull/398/merge", "Linux-node-modules-77d0", 401.7, 5),
    cache("refs/heads/feat/billing-page", "Linux-playwright-browsers", 512.0, 4),
  ],
  "acme-labs/data-pipeline": [
    cache("refs/heads/main", "pip-3.12-requirements-0be1", 88.4, 0),
    cache("refs/pull/77/merge", "pip-3.12-requirements-91fa", 87.9, 2),
  ],
  "octo-dev/tile-game": [cache("refs/heads/main", "cargo-registry-e41b", 233.0, 6)],
};

// 実行履歴の整理で検索される、古い実行（作成から 35〜120 日）
let oldRunId = 50000;
const oldRunsByRepo = {};
const addOldRuns = (repoKey, wf, count, everyNth) => {
  const list = (oldRunsByRepo[repoKey] ??= []);
  for (let i = 0; i < count; i++) {
    const failed = i % everyNth === 0;
    list.push({
      ...run(repoKey, wf, 35 + i, "completed", failed ? "failure" : "success"),
      id: oldRunId++, name: wf.name, display_title: `Old run ${i}`,
    });
  }
};
addOldRuns("acme-labs/web-console", ci, 60, 4);
addOldRuns("acme-labs/web-console", deploy, 12, 3);
addOldRuns("acme-labs/data-pipeline", workflowsByRepo["acme-labs/data-pipeline"][0], 20, 5);

// Projects: 所有者ごとのプロジェクト、プロジェクトごとの単一選択のフィールドと項目。
// 項目の status は選択肢の ID（null は未設定）。PATCH で書き換わる
const option = (id, name, color) => ({ id, name: { raw: name, html: name }, color, description: { raw: "", html: "" } });
const project = (number, title, state = "open") => ({
  id: 7000 + number, node_id: `PVT_${number}`, number, title, short_description: null, public: false,
  state, closed_at: state === "closed" ? iso(5) : null, created_at: iso(200), updated_at: iso(1),
});
const projectsByOwner = {
  "acme-labs": [project(1, "Platform roadmap"), project(2, "Design system 2024", "closed"), project(3, "Mobile releases")],
  "octo-dev": [project(4, "Side projects")],
};
const statusFieldByProject = {
  "acme-labs/1": { id: 301, name: "Status", data_type: "single_select", options: [option("todo", "Todo", "GRAY"), option("doing", "In progress", "YELLOW"), option("done", "Done", "GREEN")] },
  "acme-labs/3": { id: 303, name: "Status", data_type: "single_select", options: [option("backlog", "Backlog", "GRAY"), option("ready", "Ready", "BLUE"), option("shipped", "Shipped", "PURPLE")] },
  "octo-dev/4": { id: 304, name: "Status", data_type: "single_select", options: [option("todo4", "Todo", "GRAY"), option("done4", "Done", "GREEN")] },
};
const issueContent = (owner, number) => {
  const i = issuesByOwner[owner].find((x) => x.number === number);
  return { ...i };
};
let itemId = 9000;
const item = (type, content, status, extra = {}) => ({
  id: itemId++, node_id: `PVTI_${itemId}`, content_type: type, content, status,
  created_at: iso(20), updated_at: iso(1), archived_at: null, ...extra,
});
const projectItems = {
  "acme-labs/1": [
    item("Issue", issueContent("acme-labs", 412), "todo"),
    item("Issue", issueContent("acme-labs", 77), "doing"),
    item("Issue", issueContent("acme-labs", 398), "todo"),
    item("PullRequest", {
      id: 8801, number: 420, title: "Show an empty state on the invoice list", state: "closed", merged_at: iso(1),
      html_url: "https://github.com/acme-labs/web-console/pull/420", labels: [], assignees: [viewer],
    }, "done"),
    item("DraftIssue", { id: 8802, title: "Plan the Q1 load test", body: "" }, null),
    item("Issue", issueContent("acme-labs", 1188), "done", { archived_at: iso(3) }),
  ],
  "acme-labs/3": [item("Issue", issueContent("acme-labs", 1203), "backlog")],
  "octo-dev/4": [item("Issue", issueContent("octo-dev", 14), "todo4"), item("Issue", issueContent("octo-dev", 3), "done4")],
};

// Secrets と Variables。Environment は偽 API の都合で全リポジトリに staging と production がある
const secretOrVariable = (name, value) => ({ name, ...(value === undefined ? {} : { value }), created_at: iso(40), updated_at: iso(3) });
const configByRepo = {
  "acme-labs/web-console": {
    secrets: [secretOrVariable("NPM_TOKEN"), secretOrVariable("SENTRY_DSN")],
    variables: [secretOrVariable("NODE_VERSION", "26")],
    environments: {
      production: { secrets: [secretOrVariable("DEPLOY_KEY")], variables: [secretOrVariable("API_URL", "https://api.acme-labs.example")] },
      staging: { secrets: [], variables: [secretOrVariable("API_URL", "https://staging.acme-labs.example")] },
    },
  },
  "octo-dev/tile-game": { secrets: [secretOrVariable("ITCH_API_KEY")], variables: [], environments: {} },
};

// Releases。web-console には master のビルドを置くプレリリースと、正式な Release がある
let releaseId = 4000;
const releaseOf = (tag, name, ageDays, { prerelease = false, assets = [] } = {}) => ({
  id: releaseId++, name, tag_name: tag, draft: false, prerelease, created_at: iso(ageDays), published_at: iso(ageDays),
  html_url: `https://github.com/acme-labs/web-console/releases/tag/${tag}`, author: viewer,
  assets: assets.map(([assetName, size, downloads]) => ({
    id: releaseId++, name: assetName, size, download_count: downloads, content_type: "application/zip", updated_at: iso(ageDays),
  })),
});
const releasesByRepo = {
  "acme-labs/web-console": [
    releaseOf("master-build", "master build", 0, { prerelease: true, assets: [["chrome-extension.zip", 95341, 12]] }),
    releaseOf("v2.4.0", "v2.4.0", 20, { assets: [["web-console-2.4.0.tar.gz", 4.2 * MB, 87], ["checksums.txt", 210, 40]] }),
    releaseOf("v2.3.0", "", 60),
  ],
  "octo-dev/tile-game": [releaseOf("v0.9.0", "Beta", 5, { prerelease: true, assets: [["tile-game-web.zip", 18 * MB, 4]] })],
};

// リポジトリごとのラベル。web-console の Bug は大文字で色が違い、mobile-app の bug は説明がない。dotfiles にはラベルがない。
// secret-service は読めない（403）
let labelId = 7000;
const repoLabel = (name, color, description = null) => ({ id: labelId++, name, color, description, default: false });
const labelsByRepo = {
  "acme-labs/data-pipeline": [
    repoLabel("bug", "d73a4a", "Something isn't working"),
    repoLabel("enhancement", "a2eeef", "New feature or request"),
    repoLabel("priority: high", "b60205"),
  ],
  "acme-labs/web-console": [
    repoLabel("Bug", "ff0000", "Something isn't working"),
    repoLabel("enhancement", "a2eeef", "New feature or request"),
    repoLabel("type: bug", "d73a4a", "Bug reports"),
  ],
  "acme-labs/mobile-app": [repoLabel("bug", "d73a4a"), repoLabel("enhancement", "a2eeef", "New feature or request")],
  "octo-dev/dotfiles": [],
  "octo-dev/tile-game": [
    repoLabel("bug", "d73a4a", "Something isn't working"),
    repoLabel("enhancement", "a2eeef", "New feature or request"),
    repoLabel("good first issue", "7057ff", "Good for newcomers"),
  ],
};

// リポジトリの設定。基準はスカッシュだけを許可し、マージ後にブランチを消し、既定のブランチを PR 必須で保護する。
// web-console はマージコミットを許可しブランチを消さず、mobile-app は Wiki がありブランチ保護を使えない（無料プラン）。
// dotfiles はマージの設定が返らず（権限で読めない）、既定のブランチが main で保護していない
const baseSettings = {
  visibility: "private", default_branch: "master", has_issues: true, has_projects: true, has_wiki: false, has_discussions: false,
  allow_merge_commit: false, allow_squash_merge: true, allow_rebase_merge: false, allow_auto_merge: true,
  delete_branch_on_merge: true, allow_update_branch: true, web_commit_signoff_required: false,
};
const strictRules = [{ type: "pull_request", parameters: { required_approving_review_count: 1 } }, { type: "non_fast_forward" }, { type: "deletion" }];
const repoSettingsByRepo = {
  "acme-labs/data-pipeline": { settings: baseSettings, protected: true, rules: strictRules },
  "acme-labs/web-console": {
    settings: { ...baseSettings, allow_merge_commit: true, delete_branch_on_merge: false },
    protected: true,
    rules: [...strictRules, { type: "required_status_checks", parameters: { required_status_checks: [{ context: "ci" }] } }],
  },
  "acme-labs/mobile-app": { settings: { ...baseSettings, has_wiki: true }, protected: false, rules: "upgrade" },
  "octo-dev/dotfiles": {
    settings: Object.fromEntries(Object.entries({ ...baseSettings, default_branch: "main" }).filter(([k]) => !k.startsWith("allow_") && k !== "delete_branch_on_merge" && k !== "web_commit_signoff_required")),
    protected: false,
    rules: [],
  },
  "octo-dev/tile-game": { settings: baseSettings, protected: true, rules: strictRules },
};

module.exports = {
  repoSettingsByRepo,
  labelsByRepo,
  archivedRunsByRepo,
  releasesByRepo,
  configByRepo,
  viewer, orgs, repos, artifactsByRepo, issuesByOwner, workflowsByRepo, runsByRepo, workflowYaml, cachesByRepo, oldRunsByRepo,
  projectsByOwner, statusFieldByProject, projectItems,
};

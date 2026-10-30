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
  html_url: `https://github.com/${owner.login}/${name}`, pushed_at: iso(1), _type: ownerType,
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

module.exports = { viewer, orgs, repos, artifactsByRepo, issuesByOwner };

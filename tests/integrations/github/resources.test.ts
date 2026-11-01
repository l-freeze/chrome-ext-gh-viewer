// アーティファクト・キャッシュ・Actions・リポジトリの中身の API 呼び出しと応答の読み取り。
import { describe, expect, it } from "vitest";
import { dispatchWorkflow, deleteRun, listRecentRuns, listWorkflows, readRun, searchRuns } from "../../../src/integrations/github/actions";
import { artifactZipRequest, deleteArtifact, listArtifacts, readArtifact } from "../../../src/integrations/github/artifacts";
import { deleteCache, listCaches } from "../../../src/integrations/github/caches";
import { getFileText, listBranches, listEnvironments } from "../../../src/integrations/github/contents";
import { json, rawArtifact, testHttp } from "../../helpers";

const repo = { owner: "acme", name: "web" };

describe("アーティファクト", () => {
  it("null になりうる項目を受け付ける", () => {
    const raw = { ...rawArtifact(1), created_at: null, expires_at: null, updated_at: null, workflow_run: null };
    const { digest: _d, ...noDigest } = raw;
    expect(readArtifact(noDigest)).toMatchObject({ created_at: null, workflow_run: null, digest: null });
  });

  it("一覧は複数ページを結合し、パスをエンコードする", async () => {
    const { http, calls } = testHttp((call) =>
      call.url.searchParams.get("page") === "2"
        ? json({ total_count: 3, artifacts: [rawArtifact(3)] })
        : json(
            { total_count: 3, artifacts: [rawArtifact(1), rawArtifact(2)] },
            { headers: { link: '<https://api.github.com/repos/acme/my%20repo/actions/artifacts?per_page=100&page=2>; rel="next"' } },
          ),
    );
    expect((await listArtifacts(http, { owner: "acme", name: "my repo" })).map((a) => a.id)).toEqual([1, 2, 3]);
    expect(calls[0]!.url.pathname).toBe("/repos/acme/my%20repo/actions/artifacts");
  });

  it("削除は DELETE、ZIP はブラウザのダウンロード用の URL とヘッダー", async () => {
    const { http, calls } = testHttp(() => new Response(null, { status: 204 }));
    await deleteArtifact(http, repo, 42);
    expect(`${calls[0]!.method} ${calls[0]!.url.pathname}`).toBe("DELETE /repos/acme/web/actions/artifacts/42");
    const req = artifactZipRequest(http, repo, 7);
    expect(req.url).toBe("https://api.github.com/repos/acme/web/actions/artifacts/7/zip");
    expect(req.headers).toContainEqual({ name: "Authorization", value: "Bearer ghp_test" });
  });
});

describe("キャッシュ", () => {
  it("最終使用の新しい順で取得し、ID で削除する", async () => {
    const { http, calls } = testHttp((call) =>
      call.method === "DELETE"
        ? new Response(null, { status: 204 })
        : json({
            total_count: 1,
            actions_caches: [
              { id: 5, ref: "refs/pull/3/merge", key: "k", version: "v", size_in_bytes: 10, last_accessed_at: "2026-10-30T00:00:00Z", created_at: null },
            ],
          }),
    );
    expect(await listCaches(http, repo)).toEqual([
      { id: 5, ref: "refs/pull/3/merge", key: "k", version: "v", size_in_bytes: 10, last_accessed_at: "2026-10-30T00:00:00Z", created_at: null },
    ]);
    expect(calls[0]!.url.searchParams.get("sort")).toBe("last_accessed_at");
    await deleteCache(http, repo, 5);
    expect(`${calls[1]!.method} ${calls[1]!.url.pathname}`).toBe("DELETE /repos/acme/web/actions/caches/5");
  });
});

const rawRun = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  workflow_id: 10,
  name: "CI",
  display_title: "Fix",
  run_number: id,
  status: "completed",
  conclusion: "success",
  event: "push",
  head_branch: "main",
  actor: { login: "alice", id: 1, avatar_url: "a" },
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  html_url: "",
  ...extra,
});

describe("Actions", () => {
  it("実行の actor が null でも読める", () => {
    expect(readRun(rawRun(1, { actor: null })).actor).toBeNull();
  });

  it("ワークフロー一覧と最近の実行", async () => {
    const { http } = testHttp((call) =>
      call.url.pathname.endsWith("/workflows")
        ? json({ total_count: 1, workflows: [{ id: 10, name: "CI", path: ".github/workflows/ci.yml", state: "active", html_url: "u" }] })
        : json({ total_count: 1, workflow_runs: [rawRun(1)] }),
    );
    expect((await listWorkflows(http, repo)).map((w) => w.name)).toEqual(["CI"]);
    expect((await listRecentRuns(http, repo)).map((r) => [r.id, r.actor?.login])).toEqual([[1, "alice"]]);
  });

  it("実行の検索は条件を渡し、上限で打ち切って truncated を返す", async () => {
    const { http, calls } = testHttp((call) => {
      const page = Number(call.url.searchParams.get("page") ?? "1");
      return json(
        { total_count: 2500, workflow_runs: Array.from({ length: 100 }, (_, i) => rawRun(page * 1000 + i)) },
        { headers: { link: `<https://api.github.com/repos/acme/web/actions/runs?per_page=100&page=${page + 1}>; rel="next"` } },
      );
    });
    const res = await searchRuns(http, repo, { created: "<2026-10-01", status: "completed" }, { maxResults: 250 });
    expect(res.runs).toHaveLength(250);
    expect(res.truncated).toBe(true);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.url.searchParams.get("created")).toBe("<2026-10-01");
    expect(calls[0]!.url.searchParams.get("status")).toBe("completed");
  });

  it("実行の削除と、手動実行（ref と inputs を POST）", async () => {
    const { http, calls } = testHttp(() => new Response(null, { status: 204 }));
    await deleteRun(http, repo, 9);
    await dispatchWorkflow(http, repo, 7, "master", { level: "debug" });
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      "DELETE /repos/acme/web/actions/runs/9",
      "POST /repos/acme/web/actions/workflows/7/dispatches",
    ]);
    expect(JSON.parse(calls[1]!.body!)).toEqual({ ref: "master", inputs: { level: "debug" } });
  });
});

describe("リポジトリの中身", () => {
  it("ファイルは raw で取得し、パスの各部分をエンコードする", async () => {
    const { http, calls } = testHttp(() => new Response("on: push\n", { status: 200 }));
    expect(await getFileText(http, repo, ".github/workflows/a b.yml", "feat/x")).toBe("on: push\n");
    expect(calls[0]!.url.pathname).toBe("/repos/acme/web/contents/.github/workflows/a%20b.yml");
    expect(calls[0]!.url.searchParams.get("ref")).toBe("feat/x");
    expect(calls[0]!.headers.get("accept")).toBe("application/vnd.github.raw+json");
  });

  it("ブランチと Environment の名前", async () => {
    const { http } = testHttp((call) =>
      call.url.pathname.endsWith("/branches")
        ? json([{ name: "master", commit: {}, protected: true }, { name: "dev", commit: {}, protected: false }])
        : json({ total_count: 1, environments: [{ id: 1, name: "prod" }] }),
    );
    expect(await listBranches(http, repo)).toEqual(["master", "dev"]);
    expect(await listEnvironments(http, repo)).toEqual(["prod"]);
  });
});

import { describe, expect, it } from "vitest";
import { createLabelsFeature } from "../../src/features/labels/compose";
import { createGitHubLabelSource } from "../../src/features/labels/gateways/github";
import { changedFields, readLabelName, type Label } from "../../src/features/labels/label";
import { buildPlan, buildTable, cellStatus, deletionTargets, hasDifference, referenceOf, type LabelChange, type LabelTable, type RowEdit } from "../../src/features/labels/sync";
import type { Repository } from "../../src/features/workspace/repository";
import { json, testHttp } from "../helpers";

const label = (repo: string, name: string, color = "d73a4a", description = ""): Label => ({ repo: { owner: "acme", name: repo }, name, color, description });
const repo = (name: string, archived = false): Repository => ({
  id: name.length, owner: { login: "acme", id: 1, type: "Organization", avatarUrl: "" }, name, fullName: `acme/${name}`,
  private: true, archived, htmlUrl: `https://github.com/acme/${name}`, pushedAt: null, defaultBranch: "master",
});
const source = (name: string, ...labels: Label[]) => ({ repo: { owner: "acme", name }, labels });
const allRepos = (t: LabelTable) => new Set(t.columns.map((c) => c.key));
const describeChange = (c: LabelChange) =>
  c.kind === "create" ? `create ${c.repo.name} ${c.next.name} #${c.next.color}` : `update ${c.repo.name} ${c.current.name}→${c.next.name} [${c.fields.join(",")}]`;

describe("ラベルの規則", () => {
  it("変える項目を、名前（大文字と小文字も）・色（大文字と小文字は区別しない）・説明で比べる", () => {
    expect(changedFields(label("a", "Bug", "D73A4A", "x"), label("a", "bug", "d73a4a", "y"))).toEqual(["name", "description"]);
    expect(changedFields(label("a", "bug"), label("a", "bug"))).toEqual([]);
  });

  it("入力した名前は前後の空白を除き、空と 50 文字を超えるものは受け付けない", () => {
    expect(readLabelName("  priority: high ")).toEqual({ ok: true, name: "priority: high" });
    expect(readLabelName("   ")).toEqual({ ok: false, reason: "empty" });
    expect(readLabelName("x".repeat(51))).toEqual({ ok: false, reason: "tooLong" });
    expect(readLabelName("あ".repeat(50))).toMatchObject({ ok: true });
  });
});

describe("ラベルの表", () => {
  const table = buildTable([
    source("web", label("web", "bug", "d73a4a", "Something isn't working"), label("web", "priority: high", "b60205")),
    source("api", label("api", "Bug", "ff0000", "Something isn't working"), label("api", "type: bug", "d73a4a")),
    source("cli", label("cli", "bug", "d73a4a", "")),
    source("empty"),
  ]);
  const row = (key: string) => table.rows.find((r) => r.key === key)!;

  it("列はリポジトリの名前順（ラベルの無いリポジトリも列にする）、行は大文字と小文字を区別しない名前順", () => {
    expect(table.columns.map((c) => c.key)).toEqual(["acme/api", "acme/cli", "acme/empty", "acme/web"]);
    expect(table.rows.map((r) => r.key)).toEqual(["bug", "priority: high", "type: bug"]);
    expect(row("bug").cells.map((c) => c?.name ?? null)).toEqual(["Bug", "bug", null, "bug"]);
  });

  it("基準は、名前・色・説明それぞれでいちばん多い値（同じ数なら左の列）。リポジトリを選べばその値", () => {
    expect(row("bug").majority).toEqual({ name: "bug", color: "d73a4a", description: "Something isn't working" });
    expect(referenceOf(table, row("bug"), { reference: "acme/api" })).toEqual({ name: "Bug", color: "ff0000", description: "Something isn't working" });
    // 大文字と小文字だけの違いの名前の変更は、基準の名前を変えるだけ
    expect(referenceOf(table, row("bug"), { renameTo: "BUG" }).name).toBe("BUG");
  });

  it("マスの状態と、そろっていない行", () => {
    const ref = referenceOf(table, row("bug"), undefined);
    expect(row("bug").cells.map((c) => cellStatus(c, ref))).toEqual(["differs", "differs", "missing", "same"]);
    expect(hasDifference(table, row("bug"), undefined)).toBe(true);
    const full = buildTable([source("a", label("a", "x")), source("b", label("b", "x"))]);
    expect(hasDifference(full, full.rows[0]!, undefined)).toBe(false);
    expect(hasDifference(full, full.rows[0]!, { renameTo: "y" })).toBe(true);
  });

  it("予定: 値が違うものを変え、足りないところに追加する。どちらかだけにもできる", () => {
    const plan = buildPlan(table, { repos: allRepos(table), rows: ["bug"], edits: new Map(), add: true, update: true });
    expect(plan.changes.map(describeChange)).toEqual([
      "update api Bug→bug [name,color]",
      "update cli bug→bug [description]",
      "create empty bug #d73a4a",
    ]);
    expect(buildPlan(table, { repos: allRepos(table), rows: ["bug"], edits: new Map(), add: false, update: true }).changes).toHaveLength(2);
    expect(buildPlan(table, { repos: allRepos(table), rows: ["bug"], edits: new Map(), add: true, update: false }).changes.map(describeChange)).toEqual(["create empty bug #d73a4a"]);
    expect(plan.skipped).toEqual([]);
  });

  it("予定: 別の名前へ変えるときは、変更後の行の基準の値にし、すでにその名前があるリポジトリは飛ばす", () => {
    const edits = new Map<string, RowEdit>([["type: bug", { renameTo: "bug" }]]);
    // api には Bug があるので飛ばす
    const plan = buildPlan(table, { repos: allRepos(table), rows: ["type: bug"], edits, add: true, update: true });
    expect(plan.changes).toEqual([]);
    expect(plan.skipped.map((s) => `${s.repo.name} ${s.current.name}→${s.target}`)).toEqual(["api type: bug→bug"]);

    const t2 = buildTable([source("a", label("a", "type: bug", "000000")), source("b", label("b", "bug", "d73a4a", "B"))]);
    const p2 = buildPlan(t2, { repos: allRepos(t2), rows: ["type: bug", "bug"], edits: new Map([["type: bug", { renameTo: "bug" }]]), add: true, update: true });
    // a の type: bug を bug へ変えるので、a に bug は追加しない
    expect(p2.changes.map(describeChange)).toEqual(["update a type: bug→bug [name,color,description]"]);
    expect(p2.changes[0]!.next).toEqual({ name: "bug", color: "d73a4a", description: "B" });
  });

  it("予定: 対象のリポジトリにだけ送る。対象が無ければ何も送らない", () => {
    const only = (...keys: string[]) => buildPlan(table, { repos: new Set(keys), rows: ["bug", "type: bug"], edits: new Map([["type: bug", { renameTo: "kind: bug" }]]), add: true, update: true });
    expect(only("acme/empty").changes.map(describeChange)).toEqual(["create empty bug #d73a4a"]);
    expect(only("acme/api").changes.map(describeChange)).toEqual(["update api type: bug→kind: bug [name]", "update api Bug→bug [name,color]"]);
    expect(only()).toEqual({ changes: [], skipped: [] });
  });

  it("削除の対象は、選んだラベルのうち対象のリポジトリにあるもの（行・列の順）", () => {
    const targets = deletionTargets(table, ["type: bug", "bug"], new Set(["acme/api", "acme/web", "acme/empty"]));
    expect(targets.map((l) => `${l.repo.name}:${l.name}`)).toEqual(["api:Bug", "web:bug", "api:type: bug"]);
    expect(deletionTargets(table, ["bug"], new Set())).toEqual([]);
  });

  it("予定: まだどこにも無い名前へ変えるときは、この行の色と説明を使う。同じリポジトリで同じ名前へ 2 つ変えるなら後のものは飛ばす", () => {
    const t = buildTable([source("a", label("a", "defect", "111111", "d"), label("a", "Defect!", "222222"))]);
    const plan = buildPlan(t, { repos: allRepos(t),
      rows: ["defect", "defect!"],
      edits: new Map([["defect", { renameTo: "kind: bug" }], ["defect!", { renameTo: "Kind: Bug" }]]),
      add: true,
      update: true,
    });
    expect(plan.changes.map(describeChange)).toEqual(["update a defect→kind: bug [name]"]);
    expect(plan.changes[0]!.next).toEqual({ name: "kind: bug", color: "111111", description: "d" });
    expect(plan.skipped.map((s) => s.current.name)).toEqual(["Defect!"]);
  });
});

describe("GitHub とのやり取り", () => {
  it("削除は 1 件ずつ順に DELETE を送る。すでに無い（404）ものは成功とみなし、ほかの失敗では止めない", async () => {
    const { http, calls } = testHttp((c) =>
      c.url.pathname.includes("/gone/")
        ? json({ message: "Not Found" }, { status: 404 })
        : c.url.pathname.includes("/locked/")
          ? json({ message: "Resource not accessible by personal access token" }, { status: 403 })
          : new Response(null, { status: 204 }),
    );
    const f = createLabelsFeature({ source: createGitHubLabelSource(() => http) });
    const res = await f.remove([label("gone", "bug"), label("locked", "bug"), label("web", "type: bug")]);
    expect(res.map((r) => r.ok)).toEqual([true, false, true]);
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      "DELETE /repos/acme/gone/labels/bug",
      "DELETE /repos/acme/locked/labels/bug",
      "DELETE /repos/acme/web/labels/type%3A%20bug",
    ]);
  });

  it("一覧はリポジトリごとに読み、アーカイブ済みのリポジトリは呼ばない。色は小文字、説明の null は空にする", async () => {
    const { http, calls } = testHttp(() => json([{ id: 1, name: "bug", color: "D73A4A", description: null, default: true }]));
    const f = createLabelsFeature({ source: createGitHubLabelSource(() => http) });
    const res = await f.list([repo("web"), repo("old", true)]);
    expect(res.map((r) => r.ok && r.value)).toEqual([[{ repo: { owner: "acme", name: "web" }, name: "bug", color: "d73a4a", description: "" }], []]);
    expect(calls.map((c) => `${c.method} ${c.url.pathname}?${c.url.searchParams}`)).toEqual(["GET /repos/acme/web/labels?per_page=100"]);
  });

  it("追加は POST、変更は今の名前の URL へ PATCH（new_name で名前も変える）。1 件ずつ順に送り、失敗しても続ける", async () => {
    let active = 0;
    let maxActive = 0;
    const { http, calls } = testHttp(async (c) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      if (c.url.pathname.includes("/locked/")) return json({ message: "Resource not accessible by personal access token" }, { status: 403 });
      const body = JSON.parse(c.body ?? "{}");
      return json({ id: 2, name: body.new_name ?? body.name, color: body.color, description: body.description });
    });
    const f = createLabelsFeature({ source: createGitHubLabelSource(() => http) });
    const changes: LabelChange[] = [
      { kind: "update", repo: { owner: "acme", name: "api" }, current: label("api", "type: bug"), next: { name: "bug", color: "D73A4A", description: "B" }, fields: ["name"] },
      { kind: "create", repo: { owner: "acme", name: "locked" }, next: { name: "bug", color: "d73a4a", description: "" } },
      { kind: "create", repo: { owner: "acme", name: "web" }, next: { name: "bug", color: "d73a4a", description: "" } },
    ];
    const res = await f.apply(changes);
    expect(res.map((r) => r.ok)).toEqual([true, false, true]);
    expect(maxActive).toBe(1);
    expect(calls.map((c) => `${c.method} ${c.url.pathname} ${c.body}`)).toEqual([
      `PATCH /repos/acme/api/labels/type%3A%20bug {"new_name":"bug","color":"d73a4a","description":"B"}`,
      `POST /repos/acme/locked/labels {"name":"bug","color":"d73a4a","description":""}`,
      `POST /repos/acme/web/labels {"name":"bug","color":"d73a4a","description":""}`,
    ]);
  });
});

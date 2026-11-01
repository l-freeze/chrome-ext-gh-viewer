import { describe, expect, it } from "vitest";
import { adjacentStatus, columnsOf, withItemStatus, type Board } from "../../src/features/projects/board";
import { createProjectsFeature } from "../../src/features/projects/compose";
import { createGitHubProjectSource } from "../../src/features/projects/gateways/github";
import { createBoardPreferencesStorage } from "../../src/features/projects/gateways/storage";
import { pickStatusField, type ItemKind, type Project, type ProjectItem, type SelectField } from "../../src/features/projects/project";
import { DEFAULT_BOARD_PREFERENCES, type ProjectSource } from "../../src/features/projects/ports";
import { InvalidMoveError } from "../../src/features/projects/use-cases/move-item";
import type { Owner } from "../../src/features/workspace/repository";
import { memoryDriver } from "../../src/infrastructure/storage/drivers/memory";
import { json, testHttp } from "../helpers";

const acme: Owner = { login: "acme", id: 1, type: "Organization", avatarUrl: "" };
const me: Owner = { login: "me", id: 2, type: "User", avatarUrl: "" };

const project = (number: number, o: Partial<Project> = {}): Project => ({
  id: number, number, owner: acme, title: `P${number}`, shortDescription: null, closed: false,
  htmlUrl: "", updatedAt: "2026-10-01T00:00:00Z", ...o,
});
const status: SelectField = {
  id: 30, name: "Status",
  options: [
    { id: "todo", name: "Todo", color: "GRAY", description: null },
    { id: "doing", name: "Doing", color: "BLUE", description: null },
    { id: "done", name: "Done", color: "GREEN", description: null },
  ],
};
const item = (id: number, statusId: string | null, kind: ItemKind = "issue"): ProjectItem => ({
  id, kind, title: `Item ${id}`, number: id, repo: { owner: "acme", name: "web" }, htmlUrl: "", state: "open",
  labels: [], assignees: [], statusId, updatedAt: "2026-10-01T00:00:00Z",
});
const board = (items: ProjectItem[], field: SelectField | null = status): Board => ({ project: project(1), field, items });
const all = new Set<ItemKind>(["issue", "pull_request", "draft"]);

describe("カンバンの列", () => {
  it("Status という名前のフィールドを優先し、なければ最初の単一選択のフィールドを使う", () => {
    const priority: SelectField = { id: 1, name: "Priority", options: [] };
    expect(pickStatusField([priority, status])).toBe(status);
    expect(pickStatusField([priority])).toBe(priority);
    expect(pickStatusField([])).toBeNull();
  });

  it("選択肢の順に列を作り、未設定の列は該当する項目があるときだけ先頭に置く", () => {
    const shape = (b: Board, kinds = all) => columnsOf(b, kinds).map((c) => [c.option?.id ?? null, c.items.map((i) => i.id)]);
    expect(shape(board([item(1, "doing"), item(2, "todo")]))).toEqual([["todo", [2]], ["doing", [1]], ["done", []]]);
    // 選択肢にない値も未設定として扱う
    expect(shape(board([item(1, null), item(2, "removed")]))).toEqual([[null, [1, 2]], ["todo", []], ["doing", []], ["done", []]]);
    expect(shape(board([item(1, null)], null))).toEqual([[null, [1]]]);
  });

  it("表示する種類だけを列に入れる（取得し直さない）", () => {
    const b = board([item(1, "todo"), item(2, "todo", "pull_request"), item(3, "todo", "draft")]);
    expect(columnsOf(b, new Set<ItemKind>(["issue", "draft"]))[0]!.items.map((i) => i.id)).toEqual([1, 3]);
  });

  it("キーボードでは隣の列へ動かす。端より先へは動かさない", () => {
    const b = board([item(1, "todo"), item(2, "done"), item(3, null)]);
    expect(adjacentStatus(b, b.items[0]!, 1)).toBe("doing");
    expect(adjacentStatus(b, b.items[0]!, -1)).toBeNull();
    expect(adjacentStatus(b, b.items[1]!, 1)).toBeUndefined();
    expect(adjacentStatus(b, b.items[2]!, -1)).toBeUndefined();
    expect(adjacentStatus(board([item(1, null)], null), item(1, null), 1)).toBeUndefined();
  });

  it("列を変えた盤面は新しく作り、元の盤面は変えない", () => {
    const b = board([item(1, "todo")]);
    expect(withItemStatus(b, 1, "done").items[0]!.statusId).toBe("done");
    expect(b.items[0]!.statusId).toBe("todo");
  });
});

describe("プロジェクトの操作", () => {
  const fake = (o: Partial<ProjectSource> = {}): ProjectSource => ({
    listProjects: async () => [],
    listSelectFields: async () => [status],
    listItems: async () => [],
    setItemField: async () => undefined,
    ...o,
  });
  const feature = (source: ProjectSource) => createProjectsFeature({ source, preferences: createBoardPreferencesStorage(memoryDriver()) });

  it("所有者ごとに開いているプロジェクトをタイトル順で返し、失敗した所有者はエラーとして返す", async () => {
    const f = feature(
      fake({
        async listProjects(owner) {
          if (owner.login === "me") throw new Error("forbidden");
          return [project(1, { title: "Zeta" }), project(2, { title: "Alpha" }), project(3, { title: "Old", closed: true })];
        },
      }),
    );
    const res = await f.listProjects([acme, me]);
    expect(res.map((r) => [r.owner.login, r.projects.map((p) => p.title), r.error === null])).toEqual([
      ["acme", ["Alpha", "Zeta"], true],
      ["me", [], false],
    ]);
  });

  it("選択肢にない値や、プロジェクトにない項目へは動かさない", async () => {
    const sent: unknown[] = [];
    const f = feature(fake({ setItemField: async (...args) => void sent.push(args.slice(1)) }));
    const b = board([item(1, "todo")]);
    await expect(f.moveItem(b, 1, "nope")).rejects.toBeInstanceOf(InvalidMoveError);
    await expect(f.moveItem(b, 99, "done")).rejects.toBeInstanceOf(InvalidMoveError);
    await expect(f.moveItem(board([item(1, null)], null), 1, null)).rejects.toBeInstanceOf(InvalidMoveError);
    await f.moveItem(b, 1, "done");
    await f.moveItem(b, 1, null);
    expect(sent).toEqual([[1, 30, "done"], [1, 30, null]]);
  });

  it("表示の好みは、保存がなければ Issue とドラフトを表示し、知らない種類は読み捨てる", async () => {
    const driver = memoryDriver();
    const store = createBoardPreferencesStorage(driver);
    expect(await store.load()).toEqual(DEFAULT_BOARD_PREFERENCES);
    await store.save({ kinds: ["pull_request"], collapsed: ["acme/1"] });
    expect(await store.load()).toEqual({ kinds: ["pull_request"], collapsed: ["acme/1"] });
    await driver.set("projectBoard", { kinds: ["issue", "note"], collapsed: [] });
    expect((await store.load()).kinds).toEqual(["issue"]);
  });
});

describe("GitHub からカンバンを読み込む", () => {
  const rawItem = (id: number, type: string, content: unknown, value: unknown, archived: string | null = null) => ({
    id, content_type: type, archived_at: archived, updated_at: "2026-10-02T00:00:00Z", content,
    fields: [{ id: 30, name: "Status", data_type: "single_select", value }],
  });

  it("フィールドと項目を 1 回ずつ取得し、列にするフィールドの値も一緒に受け取る", async () => {
    const { http, calls } = testHttp((c) => {
      if (c.url.pathname.endsWith("/fields")) {
        return json([
          { id: 10, name: "Title", data_type: "title" },
          { id: 30, name: "Status", data_type: "single_select", options: [{ id: "todo", name: { raw: "Todo", html: "Todo" }, color: "GRAY", description: { raw: "", html: "" } }] },
        ]);
      }
      return json([
        rawItem(1, "Issue", { title: "Bug", number: 7, html_url: "https://github.com/acme/web/issues/7", state: "closed", labels: [], assignees: [{ login: "bob", avatar_url: "a" }] }, { id: "todo" }),
        rawItem(2, "PullRequest", { title: "Fix", number: 8, html_url: "https://github.com/acme/web/pull/8", state: "closed", merged_at: "2026-10-01T00:00:00Z" }, null),
        rawItem(3, "DraftIssue", { title: "Idea", number: 0 }, null),
        rawItem(4, "Issue", { title: "Old" }, null, "2026-09-01T00:00:00Z"),
      ]);
    });
    const f = createProjectsFeature({ source: createGitHubProjectSource(() => http), preferences: createBoardPreferencesStorage(memoryDriver()) });
    const b = await f.loadBoard(project(5));

    expect(calls.map((c) => `${c.url.pathname}?${c.url.searchParams}`)).toEqual([
      "/orgs/acme/projectsV2/5/fields?per_page=100",
      "/orgs/acme/projectsV2/5/items?per_page=100&fields=30",
    ]);
    expect(b.field?.options.map((o) => o.name)).toEqual(["Todo"]);
    expect(b.items.map((i) => [i.id, i.kind, i.state, i.statusId, i.repo && `${i.repo.owner}/${i.repo.name}`, i.number])).toEqual([
      [1, "issue", "closed", "todo", "acme/web", 7],
      [2, "pull_request", "merged", null, "acme/web", 8],
      [3, "draft", null, null, null, null],
    ]);
    expect(b.items[0]!.assignees).toEqual([{ login: "bob", avatarUrl: "a" }]);
  });

  it("単一選択のフィールドがなければ、フィールドの値を求めずに項目を取得する", async () => {
    const { http, calls } = testHttp((c) => (c.url.pathname.endsWith("/fields") ? json([{ id: 10, name: "Title", data_type: "title" }]) : json([])));
    const f = createProjectsFeature({ source: createGitHubProjectSource(() => http), preferences: createBoardPreferencesStorage(memoryDriver()) });
    const b = await f.loadBoard(project(5, { owner: me }));
    expect(b.field).toBeNull();
    expect(calls.map((c) => `${c.url.pathname}?${c.url.searchParams}`)).toEqual([
      "/users/me/projectsV2/5/fields?per_page=100",
      "/users/me/projectsV2/5/items?per_page=100",
    ]);
  });
});

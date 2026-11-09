import { describe, expect, it } from "vitest";
import {
  addProjectItem,
  deleteProjectItem,
  listOwnerProjects,
  listProjectItems,
  readItem,
  selectedOptionId,
  updateProjectItemField,
} from "../../../src/integrations/github/projects";
import { json, testHttp } from "../../helpers";

const rawProject = (number: number, o: Record<string, unknown> = {}) => ({
  id: 1000 + number, number, title: `Project ${number}`, short_description: null, state: "open", closed_at: null,
  updated_at: "2026-10-01T00:00:00Z", ...o,
});

describe("Projects API", () => {
  it("Organization と個人で取得先を分け、Link ヘッダーで次のページをたどる", async () => {
    const { http, calls } = testHttp((c) => {
      if (c.url.pathname === "/orgs/acme/projectsV2" && !c.url.searchParams.has("after")) {
        return json([rawProject(1)], { headers: { link: '<https://api.github.com/orgs/acme/projectsV2?per_page=100&after=abc>; rel="next"' } });
      }
      if (c.url.pathname === "/orgs/acme/projectsV2") return json([rawProject(2, { state: "closed" })]);
      if (c.url.pathname === "/users/me/projectsV2") return json([rawProject(3)]);
      return json({}, { status: 404 });
    });
    const org = await listOwnerProjects(http, { login: "acme", type: "Organization" });
    const user = await listOwnerProjects(http, { login: "me", type: "User" });
    expect(org.map((p) => [p.number, p.state])).toEqual([[1, "open"], [2, "closed"]]);
    expect(user.map((p) => p.number)).toEqual([3]);
    expect(calls.map((c) => `${c.url.pathname}?${c.url.searchParams}`)).toEqual([
      "/orgs/acme/projectsV2?per_page=100",
      "/orgs/acme/projectsV2?per_page=100&after=abc",
      "/users/me/projectsV2?per_page=100",
    ]);
  });

  it("項目は指定したフィールドの値と一緒に取得する", async () => {
    const { http, calls } = testHttp(() =>
      json([
        {
          id: 1, content_type: "Issue", archived_at: null, updated_at: "2026-10-02T00:00:00Z",
          content: { title: "Bug", number: 7, html_url: "https://github.com/acme/web/issues/7", state: "open", labels: [{ name: "bug", color: "d73a4a" }], assignees: [] },
          fields: [{ id: 30, name: "Status", data_type: "single_select", value: { id: "opt-2", name: { raw: "Doing", html: "Doing" } } }],
        },
        { id: 2, content_type: "DraftIssue", archived_at: null, updated_at: "2026-10-02T00:00:00Z", content: { title: "Idea" }, fields: [{ id: 30, value: null }] },
        { id: 3, content_type: "Issue", archived_at: null, updated_at: "2026-10-02T00:00:00Z", content: null },
      ]),
    );
    const items = await listProjectItems(http, { owner: { login: "acme", type: "Organization" }, number: 5 }, { fieldIds: [30] });
    expect(calls[0]!.url.pathname).toBe("/orgs/acme/projectsV2/5/items");
    expect(calls[0]!.url.searchParams.get("fields")).toBe("30");
    expect(items.map((i) => [i.id, i.content_type, i.content?.title ?? null, selectedOptionId(i.field_values.get(30))])).toEqual([
      [1, "Issue", "Bug", "opt-2"],
      [2, "DraftIssue", "Idea", null],
      [3, "Issue", null, null],
    ]);
  });

  it("知らない種類の項目は形の誤りとして扱う", () => {
    expect(() => readItem({ id: 1, content_type: "Note", archived_at: null, updated_at: "x" })).toThrow(/content_type/);
  });

  it("Issue は所有者・リポジトリ・番号で加え、項目は DELETE で外す", async () => {
    const { http, calls } = testHttp((c) =>
      c.method === "POST"
        ? json({ id: 321, content_type: "Issue", archived_at: null, updated_at: "2026-11-09T00:00:00Z", content: null }, { status: 201 })
        : new Response(null, { status: 204 }),
    );
    const project = { owner: { login: "acme", type: "Organization" }, number: 5 };
    const added = await addProjectItem(http, project, { type: "Issue", owner: "acme", repo: "web", number: 7 });
    await deleteProjectItem(http, project, 9);
    expect(added.id).toBe(321);
    expect(calls.map((c) => [c.method, c.url.pathname, c.body])).toEqual([
      ["POST", "/orgs/acme/projectsV2/5/items", JSON.stringify({ type: "Issue", owner: "acme", repo: "web", number: 7 })],
      ["DELETE", "/orgs/acme/projectsV2/5/items/9", null],
    ]);
  });

  it("項目のフィールドは PATCH で選択肢の ID を送って変える", async () => {
    const { http, calls } = testHttp(() => json({ id: 9 }));
    await updateProjectItemField(http, { owner: { login: "me", type: "User" }, number: 2 }, 9, { id: 30, value: "opt-1" });
    expect(calls.map((c) => [c.method, c.url.pathname, c.body])).toEqual([
      ["PATCH", "/users/me/projectsV2/2/items/9", JSON.stringify({ fields: [{ id: 30, value: "opt-1" }] })],
    ]);
  });
});

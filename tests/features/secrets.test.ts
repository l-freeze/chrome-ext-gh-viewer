import { describe, expect, it } from "vitest";
import { createSecretsFeature } from "../../src/features/secrets/compose";
import { createGitHubSecretSource } from "../../src/features/secrets/gateways/github";
import { filterItems, sortItems, type ConfigItem } from "../../src/features/secrets/item";
import type { Repository } from "../../src/features/workspace/repository";
import { json, testHttp } from "../helpers";

const repo = (name: string): Repository => ({
  id: name.length, owner: { login: "acme", id: 1, type: "Organization", avatarUrl: "" }, name, fullName: `acme/${name}`,
  private: true, archived: false, htmlUrl: `https://github.com/acme/${name}`, pushedAt: null, defaultBranch: "master",
});
const item = (name: string, o: Partial<ConfigItem> = {}): ConfigItem => ({
  repo: { owner: "acme", name: "web" }, environment: null, kind: "secret", name, value: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z", ...o,
});

describe("Secrets と Variables の一覧", () => {
  it("リポジトリ単位を先に、Environment は名前順、その中で Secrets・Variables の順に名前順で並べる", () => {
    const list = [
      item("B", { kind: "variable", value: "1" }),
      item("Z", { environment: "production" }),
      item("A"),
      item("C", { environment: "beta", kind: "variable", value: "x" }),
      item("D"),
    ];
    expect(sortItems(list).map((i) => `${i.environment ?? "-"}:${i.kind}:${i.name}`)).toEqual([
      "-:secret:A", "-:secret:D", "-:variable:B", "beta:variable:C", "production:secret:Z",
    ]);
  });

  it("種類と、名前・値・Environment・リポジトリの語で絞り込む", () => {
    const list = [item("NPM_TOKEN"), item("NODE_VERSION", { kind: "variable", value: "26" }), item("DEPLOY_KEY", { environment: "production" })];
    expect(filterItems(list, "variable", "").map((i) => i.name)).toEqual(["NODE_VERSION"]);
    expect(filterItems(list, "all", "26").map((i) => i.name)).toEqual(["NODE_VERSION"]);
    expect(filterItems(list, "all", "prod key").map((i) => i.name)).toEqual(["DEPLOY_KEY"]);
    expect(filterItems(list, "secret", "acme/web").map((i) => i.name)).toEqual(["NPM_TOKEN", "DEPLOY_KEY"]);
  });
});

describe("GitHub から読む", () => {
  const secrets = (...names: string[]) => ({ total_count: names.length, secrets: names.map((name) => ({ name, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" })) });
  const variables = (...pairs: Array<[string, string]>) => ({
    total_count: pairs.length,
    variables: pairs.map(([name, value]) => ({ name, value, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" })),
  });

  it("Environment がなければ、リポジトリ単位の 2 つと Environment の一覧の 3 回だけ呼ぶ", async () => {
    const { http, calls } = testHttp((c) => {
      const p = c.url.pathname;
      if (p.endsWith("/actions/secrets")) return json(secrets("NPM_TOKEN"));
      if (p.endsWith("/actions/variables")) return json(variables(["NODE_VERSION", "26"]));
      if (p.endsWith("/environments")) return json({ total_count: 0, environments: [] });
      return json({ message: "Not Found" }, { status: 404 });
    });
    const f = createSecretsFeature({ source: createGitHubSecretSource(() => http) });
    const [res] = await f.list([repo("web")]);
    expect(res!.ok && res!.value.map((i) => [i.kind, i.name, i.value, i.environment])).toEqual([
      ["secret", "NPM_TOKEN", null, null],
      ["variable", "NODE_VERSION", "26", null],
    ]);
    expect(calls.map((c) => `${c.method} ${c.url.pathname}?${c.url.searchParams}`).sort()).toEqual([
      "GET /repos/acme/web/actions/secrets?per_page=100",
      "GET /repos/acme/web/actions/variables?per_page=30",
      "GET /repos/acme/web/environments?per_page=100",
    ]);
  });

  it("Environment があれば、Environment ごとに Secrets と Variables を読む。Environment を使えない（404）なら空とみなす", async () => {
    const { http, calls } = testHttp((c) => {
      const p = c.url.pathname;
      if (p.startsWith("/repos/acme/old/environments")) return json({ message: "Not Found" }, { status: 404 });
      if (p.endsWith("/environments")) return json({ total_count: 1, environments: [{ id: 1, name: "prod eu" }] });
      if (p === "/repos/acme/web/environments/prod%20eu/secrets") return json(secrets("DEPLOY_KEY"));
      if (p === "/repos/acme/web/environments/prod%20eu/variables") return json(variables(["API_URL", "https://api.example"]));
      if (p.endsWith("/secrets")) return json(secrets());
      return json(variables());
    });
    const f = createSecretsFeature({ source: createGitHubSecretSource(() => http) });
    const [web, old] = await f.list([repo("web"), repo("old")]);
    expect(web!.ok && web!.value.map((i) => [i.environment, i.kind, i.name])).toEqual([
      ["prod eu", "secret", "DEPLOY_KEY"],
      ["prod eu", "variable", "API_URL"],
    ]);
    expect(old!.ok && old!.value).toEqual([]);
    // 書き込みの呼び出しはしない（閲覧専用）
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("読めないリポジトリは、そのリポジトリだけ失敗として返す", async () => {
    const { http } = testHttp((c) =>
      c.url.pathname.startsWith("/repos/acme/locked")
        ? json({ message: "Resource not accessible" }, { status: 403, headers: { "x-accepted-github-permissions": "secrets=read" } })
        : c.url.pathname.endsWith("/environments")
          ? json({ total_count: 0, environments: [] })
          : json(c.url.pathname.endsWith("/secrets") ? secrets() : variables()),
    );
    const f = createSecretsFeature({ source: createGitHubSecretSource(() => http) });
    const res = await f.list([repo("web"), repo("locked")]);
    expect(res.map((r) => [r.item.name, r.ok])).toEqual([["web", true], ["locked", false]]);
  });
});

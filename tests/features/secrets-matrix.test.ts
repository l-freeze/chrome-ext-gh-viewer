import { describe, expect, it } from "vitest";
import type { ConfigItem } from "../../src/features/secrets/item";
import { buildMatrix, filterRows, type MatrixRow } from "../../src/features/secrets/matrix";

const item = (repo: string, name: string, o: Partial<ConfigItem> = {}): ConfigItem => ({
  repo: { owner: "acme", name: repo }, environment: null, kind: "secret", name, value: null,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z", ...o,
});
const states = (row: MatrixRow) => row.cells.map((c) => c.state);

describe("Secrets と Variables の比較表", () => {
  const items = [
    item("web", "NPM_TOKEN"),
    item("web", "NODE_VERSION", { kind: "variable", value: "26" }),
    item("web", "DEPLOY_KEY", { environment: "production" }),
    item("web", "API_URL", { environment: "staging", kind: "variable", value: "s" }),
    item("web", "API_URL", { environment: "production", kind: "variable", value: "p" }),
    item("api", "NPM_TOKEN"),
    item("api", "DEPLOY_KEY", { environment: "production" }),
  ];

  it("列は項目のあるリポジトリを名前順に、その中はリポジトリ単位・Environment の名前順に並べる", () => {
    const m = buildMatrix(items);
    expect(m.groups.map((g) => `${g.repo.owner}/${g.repo.name}`)).toEqual(["acme/api", "acme/web"]);
    expect(m.columns.map((c) => `${c.repo.name}:${c.environment ?? "-"}`)).toEqual([
      "api:-", "api:production", "web:-", "web:production", "web:staging",
    ]);
  });

  it("行は Secrets を先に、Variables を後に、名前順に並べる。同じ名前でも種類が違えば別の行", () => {
    const m = buildMatrix([...items, item("api", "NPM_TOKEN", { kind: "variable", value: "x" })]);
    expect(m.rows.map((r) => `${r.kind}:${r.name}`)).toEqual([
      "secret:DEPLOY_KEY", "secret:NPM_TOKEN", "variable:API_URL", "variable:NODE_VERSION", "variable:NPM_TOKEN",
    ]);
  });

  it("Environment に無くてもリポジトリ単位にあれば inherited、どちらにも無ければ missing", () => {
    const m = buildMatrix(items);
    const row = (name: string) => m.rows.find((r) => r.name === name)!;
    // 列: api:- api:production web:- web:production web:staging
    expect(states(row("NPM_TOKEN"))).toEqual(["set", "inherited", "set", "inherited", "inherited"]);
    expect(states(row("DEPLOY_KEY"))).toEqual(["missing", "set", "missing", "set", "missing"]);
    expect(states(row("API_URL"))).toEqual(["missing", "missing", "missing", "set", "set"]);
    expect(row("NPM_TOKEN")).toMatchObject({ covered: 5, hasGap: false });
    expect(row("DEPLOY_KEY")).toMatchObject({ covered: 2, hasGap: true });
    // inherited のセルは、使われるリポジトリ単位の項目を持つ
    expect(row("NPM_TOKEN").cells[1]!.item).toBe(items[5]);
    expect(row("API_URL").cells[3]!.item?.value).toBe("p");
  });

  it("項目が無ければ列も行も無い", () => {
    expect(buildMatrix([])).toEqual({ groups: [], columns: [], rows: [] });
  });

  it("種類・名前の語・設定漏れのある行だけ、で行を絞り込む", () => {
    const { rows } = buildMatrix(items);
    const names = (r: MatrixRow[]) => r.map((x) => x.name);
    expect(names(filterRows(rows, { kind: "variable", text: "", gapsOnly: false }))).toEqual(["API_URL", "NODE_VERSION"]);
    expect(names(filterRows(rows, { kind: "all", text: "", gapsOnly: true }))).toEqual(["DEPLOY_KEY", "API_URL", "NODE_VERSION"]);
    expect(names(filterRows(rows, { kind: "all", text: "dep key", gapsOnly: false }))).toEqual(["DEPLOY_KEY"]);
    expect(names(filterRows(rows, { kind: "secret", text: "url", gapsOnly: false }))).toEqual([]);
  });
});

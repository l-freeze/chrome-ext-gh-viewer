// Secrets と Variables の比較表: どのリポジトリ・Environment に、どの名前があるかを行列にする（閲覧のみ）。
// 一覧（item.ts）と同じ取得結果から作るので、呼び出しは増えない。

import { repoKey, type RepoRef } from "../workspace/repository";
import type { ConfigItem, ItemKind, KindFilter } from "./item";

/** 列: リポジトリ単位（environment が null）か、そのリポジトリの Environment */
export interface MatrixColumn {
  key: string;
  repo: RepoRef;
  environment: string | null;
}

/** 見出しの 1 段目: リポジトリと、その下の列 */
export interface MatrixColumnGroup {
  repo: RepoRef;
  columns: MatrixColumn[];
}

/**
 * set: その範囲に設定がある
 * inherited: Environment には無いが、同じリポジトリのリポジトリ単位にある（その Environment のジョブからも使える）
 * missing: どちらにも無い
 */
export type CellState = "set" | "inherited" | "missing";

export interface MatrixCell {
  column: MatrixColumn;
  state: CellState;
  /** set のときの項目（inherited のときはリポジトリ単位の項目）。missing なら null */
  item: ConfigItem | null;
}

export interface MatrixRow {
  key: string;
  kind: ItemKind;
  name: string;
  cells: MatrixCell[];
  /** set か inherited の列の数 */
  covered: number;
  /** missing の列がある */
  hasGap: boolean;
}

export interface SecretMatrix {
  groups: MatrixColumnGroup[];
  columns: MatrixColumn[];
  rows: MatrixRow[];
}

export interface MatrixFilter {
  kind: KindFilter;
  /** 空白で区切った語。すべてが名前に含まれる行を残す */
  text: string;
  /** missing の列がある行だけを残す */
  gapsOnly: boolean;
}

const columnKey = (repo: RepoRef, environment: string | null) => `${repoKey(repo)}|${environment ?? ""}`;
const rowKey = (kind: ItemKind, name: string) => `${kind}|${name}`;

/**
 * リポジトリごとの取得結果から行列を作る。
 * 列は、項目が 1 つ以上あるリポジトリだけを、名前順に並べる（何も設定していないリポジトリは列にしない）。
 * リポジトリの中は、リポジトリ単位を先に、Environment を名前順に並べる。Environment の列は、そこに項目があるものだけ。
 * 行は、Secrets を先に、Variables を後に、それぞれ名前順に並べる。
 */
export function buildMatrix(items: readonly ConfigItem[]): SecretMatrix {
  const byRepo = new Map<string, { repo: RepoRef; environments: Set<string> }>();
  const present = new Map<string, ConfigItem>();
  const rowNames = new Map<string, { kind: ItemKind; name: string }>();
  for (const item of items) {
    const rk = repoKey(item.repo);
    const entry = byRepo.get(rk) ?? { repo: item.repo, environments: new Set<string>() };
    if (item.environment !== null) entry.environments.add(item.environment);
    byRepo.set(rk, entry);
    present.set(`${columnKey(item.repo, item.environment)}|${rowKey(item.kind, item.name)}`, item);
    rowNames.set(rowKey(item.kind, item.name), { kind: item.kind, name: item.name });
  }

  const groups: MatrixColumnGroup[] = [...byRepo.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { repo, environments }]) => ({
      repo,
      columns: [null, ...[...environments].sort((a, b) => a.localeCompare(b))].map((environment) => ({
        key: columnKey(repo, environment),
        repo,
        environment,
      })),
    }));
  const columns = groups.flatMap((g) => g.columns);

  const rows: MatrixRow[] = [...rowNames.values()]
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "secret" ? -1 : 1))
    .map(({ kind, name }) => {
      const rk = rowKey(kind, name);
      const cells = columns.map((column): MatrixCell => {
        const own = present.get(`${column.key}|${rk}`);
        if (own) return { column, state: "set", item: own };
        if (column.environment !== null) {
          const repoLevel = present.get(`${columnKey(column.repo, null)}|${rk}`);
          if (repoLevel) return { column, state: "inherited", item: repoLevel };
        }
        return { column, state: "missing", item: null };
      });
      const covered = cells.filter((c) => c.state !== "missing").length;
      return { key: rk, kind, name, cells, covered, hasGap: covered < cells.length };
    });

  return { groups, columns, rows };
}

/** 行だけを絞り込む（列は変えないので、見比べる相手は消えない） */
export function filterRows(rows: readonly MatrixRow[], filter: MatrixFilter): MatrixRow[] {
  const terms = filter.text.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (filter.kind !== "all" && row.kind !== filter.kind) return false;
    if (filter.gapsOnly && !row.hasGap) return false;
    const name = row.name.toLowerCase();
    return terms.every((t) => name.includes(t));
  });
}

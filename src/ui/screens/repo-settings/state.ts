// リポジトリの設定の違いの表の状態（閲覧のみ）: 取得、違いのある設定だけの絞り込み、リポジトリ名での絞り込み、並べ替え。
// 並べ替えは複数の列で行い、押した順に優先する。見出しを押すたびに昇順 → 降順 → 解除。何も無ければリポジトリ名の昇順。

import { createMemo, createSignal, type Accessor } from "solid-js";
import { compareSettings, cycleSort, rowDiffers, sortRows, type SettingsSort, type SettingsSortKey } from "../../../features/repo-settings/comparison";
import type { RepoSettings } from "../../../features/repo-settings/settings";
import { repoKey } from "../../../features/workspace/repository";
import type { UiDeps } from "../../app/context";
import type { WorkspaceState } from "../../app/workspace";
import { createRepoResults } from "../../lists/repo-results";

export function createRepoSettingsState(deps: UiDeps, ws: WorkspaceState, active: Accessor<boolean>) {
  const ops = deps.manager.repoSettings;
  const [text, setText] = createSignal("");
  const [diffOnly, setDiffOnly] = createSignal(true);
  const [sort, setSort] = createSignal<SettingsSort>([]);

  const results = createRepoResults<RepoSettings | null>({
    ws,
    fetch: (repos, options) => ops.list(repos, options),
    now: deps.manager.now,
    active,
  });

  // アーカイブ済みのリポジトリ（null）は表に出さない
  const comparison = createMemo(() => compareSettings(results.values().flatMap((r) => (r.value ? [r.value] : []))));
  const columns = createMemo(() => comparison().columns.filter((c) => !diffOnly() || !c.uniform));
  const rows = createMemo(() => {
    const terms = text().toLowerCase().split(/\s+/).filter(Boolean);
    const shown = comparison().rows.filter((r) => terms.every((t) => repoKey(r.repo).toLowerCase().includes(t)));
    return sortRows(shown, sort());
  });

  return {
    results,
    comparison,
    columns,
    rows,
    text,
    setText,
    diffOnly,
    setDiffOnly,
    sort,
    toggleSort: (key: SettingsSortKey) => setSort((s) => cycleSort(s, key)),
    resetSort: () => setSort([]),
    differingSettings: createMemo(() => comparison().columns.filter((c) => !c.uniform).length),
    differingRepos: createMemo(() => comparison().rows.filter((r) => rowDiffers(r, comparison().columns)).length),
  };
}

export type RepoSettingsState = ReturnType<typeof createRepoSettingsState>;

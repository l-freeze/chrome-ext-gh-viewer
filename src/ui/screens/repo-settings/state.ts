// リポジトリの設定の違いの表の状態（閲覧のみ）: 取得、違いのある設定だけの絞り込み、リポジトリ名での絞り込み。

import { createMemo, createSignal, type Accessor } from "solid-js";
import { compareSettings, rowDiffers } from "../../../features/repo-settings/comparison";
import type { RepoSettings } from "../../../features/repo-settings/settings";
import { repoKey } from "../../../features/workspace/repository";
import type { UiDeps } from "../../app/context";
import type { WorkspaceState } from "../../app/workspace";
import { createRepoResults } from "../../lists/repo-results";

export function createRepoSettingsState(deps: UiDeps, ws: WorkspaceState, active: Accessor<boolean>) {
  const ops = deps.manager.repoSettings;
  const [text, setText] = createSignal("");
  const [diffOnly, setDiffOnly] = createSignal(true);

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
    return comparison().rows.filter((r) => terms.every((t) => repoKey(r.repo).toLowerCase().includes(t)));
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
    differingSettings: createMemo(() => comparison().columns.filter((c) => !c.uniform).length),
    differingRepos: createMemo(() => comparison().rows.filter((r) => rowDiffers(r, comparison().columns)).length),
  };
}

export type RepoSettingsState = ReturnType<typeof createRepoSettingsState>;

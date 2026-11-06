// Secrets と Variables の一覧の状態（閲覧のみ）: 取得、種類と文字での絞り込み、リポジトリごとのまとめ。

import { createMemo, createSignal, type Accessor } from "solid-js";
import { filterItems, itemKey, sortItems, type ConfigItem, type KindFilter } from "../../../features/secrets/item";
import type { Repository } from "../../../features/workspace/repository";
import { mergeList } from "../../../lib/reuse";
import type { UiDeps } from "../../app/context";
import type { WorkspaceState } from "../../app/workspace";
import { createRepoResults } from "../../lists/repo-results";

export interface SecretGroup {
  repo: Repository;
  items: ConfigItem[];
}

export function createSecretsState(deps: UiDeps, ws: WorkspaceState, active: Accessor<boolean>) {
  const ops = deps.manager.secrets;
  const [kind, setKind] = createSignal<KindFilter>("all");
  const [text, setText] = createSignal("");

  // タブを開いているときだけ読み込む
  const results = createRepoResults<ConfigItem[]>({
    ws,
    fetch: (repos, options) => ops.list(repos, options),
    now: deps.manager.now,
    active,
    merge: mergeList(itemKey),
  });

  const items = createMemo(() => results.values().flatMap((r) => r.value));
  const groups = createMemo((): SecretGroup[] =>
    results
      .values()
      .map(({ repo, value }) => ({ repo, items: sortItems(filterItems(value, kind(), text())) }))
      .filter((g) => g.items.length > 0)
      .sort((a, b) => a.repo.fullName.localeCompare(b.repo.fullName)),
  );

  return {
    results,
    kind,
    setKind,
    text,
    setText,
    items,
    groups,
    count: createMemo(() => groups().reduce((n, g) => n + g.items.length, 0)),
  };
}

export type SecretsState = ReturnType<typeof createSecretsState>;

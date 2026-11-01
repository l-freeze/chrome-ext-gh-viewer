import { For, Show } from "solid-js";
import type { RepoUsage } from "../../features/workspace/repository";
import { useUi } from "../app/context";
import { formatBytes } from "../format";

/** リポジトリ別の容量（大きい順、上位 12 件） */
export function UsageByRepo(props: { rows: RepoUsage[]; title: string; note: string; countLabel: (count: number) => string }) {
  const { i18n } = useUi();
  const rows = () => props.rows.slice(0, 12);
  const max = () => rows()[0]?.bytes ?? 1;
  return (
    <Show when={rows().length > 0}>
      <aside class="byrepo" aria-label={props.title}>
        <h2>{props.title}</h2>
        <p class="muted small">{props.note}</p>
        <ol>
          <For each={rows()}>
            {(r) => (
              <li>
                <div class="byrepo__line">
                  <span class="byrepo__name" title={r.key}>
                    {r.repo.name}
                  </span>
                  <span class="mono">{formatBytes(r.bytes, i18n.number)}</span>
                </div>
                <span class="byrepo__bar" style={{ width: `${(r.bytes / max()) * 100}%` }} />
                <div class="muted small">
                  {r.repo.owner} · {props.countLabel(r.count)}
                </div>
              </li>
            )}
          </For>
        </ol>
      </aside>
    </Show>
  );
}

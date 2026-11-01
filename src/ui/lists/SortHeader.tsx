import type { SortState } from "../../lib/sort";

/** 押すと並べ替える列見出し */
export function SortHeader<Key extends string>(props: {
  sort: SortState<Key>;
  column: Key;
  label: string;
  numeric?: boolean;
  onSort: (key: Key) => void;
}) {
  const dir = () => (props.sort.key === props.column ? props.sort.dir : null);
  return (
    <th class={props.numeric ? "num" : undefined} aria-sort={dir() === "asc" ? "ascending" : dir() === "desc" ? "descending" : undefined}>
      <button type="button" class="sort" onClick={() => props.onSort(props.column)}>
        {props.label}
        <span class="sort__arrow" aria-hidden="true">
          {dir() === "asc" ? "↑" : dir() === "desc" ? "↓" : ""}
        </span>
      </button>
    </th>
  );
}

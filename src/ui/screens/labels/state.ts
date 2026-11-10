// ラベルのそろえ込みの状態: 取得、絞り込み、行ごとの基準と名前の変更、選択、確認 → 変更中 → 結果。
// 確認の段階を経ないと変更を送らない。確認中と変更中は取り直さない（確認した予定が変わらないように）。

import { batch, createMemo, createSignal, type Accessor } from "solid-js";
import type { Label } from "../../../features/labels/label";
import { buildPlan, buildTable, hasDifference, referenceOf, type LabelChange, type LabelRow, type RowEdit } from "../../../features/labels/sync";
import { repoKey, toRepoRef, type Repository } from "../../../features/workspace/repository";
import type { UiDeps } from "../../app/context";
import type { WorkspaceState } from "../../app/workspace";
import { createRepoResults } from "../../lists/repo-results";

export type ApplyPhase = { phase: "idle" } | { phase: "confirm" } | { phase: "applying"; done: number; total: number };
export type LabelNotice = { kind: "applied"; count: number } | { kind: "failed"; count: number; total: number; errors: unknown[] };

export function createLabelsState(deps: UiDeps, ws: WorkspaceState, active: Accessor<boolean>) {
  const ops = deps.manager.labels;
  const [text, setText] = createSignal("");
  const [diffOnly, setDiffOnly] = createSignal(true);
  const [edits, setEdits] = createSignal<ReadonlyMap<string, RowEdit>>(new Map());
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set());
  const [add, setAdd] = createSignal(true);
  const [update, setUpdate] = createSignal(true);
  const [phase, setPhase] = createSignal<ApplyPhase>({ phase: "idle" });
  const [notice, setNotice] = createSignal<LabelNotice | null>(null);

  const results = createRepoResults<Label[]>({
    ws,
    fetch: (repos, options) => ops.list(repos, options),
    now: deps.manager.now,
    active,
    onReset: () =>
      batch(() => {
        setSelected(new Set<string>());
        setEdits(new Map());
      }),
    paused: (): boolean => phase().phase !== "idle",
  });

  // アーカイブ済みのリポジトリは変えられないので列にしない
  const sources = createMemo(() => results.values().filter((r) => !r.repo.archived));
  const table = createMemo(() => buildTable(sources().map((r) => ({ repo: toRepoRef(r.repo), labels: r.value }))));
  const editOf = (row: LabelRow) => edits().get(row.key);
  const reference = (row: LabelRow) => referenceOf(table(), row, editOf(row));
  const differs = (row: LabelRow) => hasDifference(table(), row, editOf(row));

  const rows = createMemo(() => {
    const terms = text().toLowerCase().split(/\s+/).filter(Boolean);
    return table().rows.filter((row) => (!diffOnly() || differs(row)) && terms.every((t) => row.key.includes(t)));
  });
  const diffCount = createMemo(() => table().rows.filter(differs).length);
  const selectedKeys = createMemo(() => table().rows.filter((r) => selected().has(r.key)).map((r) => r.key));
  const plan = createMemo(() => buildPlan(table(), { rows: selectedKeys(), edits: edits(), add: add(), update: update() }));

  const editRow = (key: string, fn: (edit: RowEdit) => RowEdit) =>
    setEdits((m) => {
      const next = new Map(m);
      const edit = fn({ ...(m.get(key) ?? {}) });
      if (edit.reference === undefined && edit.renameTo === undefined) next.delete(key);
      else next.set(key, edit);
      return next;
    });

  async function apply() {
    const changes = plan().changes;
    if (phase().phase !== "confirm" || changes.length === 0) return;
    setPhase({ phase: "applying", done: 0, total: changes.length });
    const res = await ops.apply(changes, { onProgress: (p) => setPhase({ phase: "applying", ...p }) });
    const failed = res.filter((r) => !r.ok);
    // 変えたリポジトリだけ取り直す
    const touched = new Set(changes.map((c: LabelChange) => repoKey(c.repo)));
    const repos: Repository[] = sources()
      .map((r) => r.repo)
      .filter((r) => touched.has(repoKey(toRepoRef(r))));
    batch(() => {
      setPhase({ phase: "idle" });
      setSelected(new Set<string>());
      setEdits(new Map());
      setNotice(
        failed.length === 0
          ? { kind: "applied", count: res.length }
          : { kind: "failed", count: failed.length, total: res.length, errors: failed.map((r) => (r.ok ? null : r.error)) },
      );
    });
    results.reload(repos);
  }

  return {
    results,
    table,
    rows,
    reference,
    differs,
    diffCount,
    edit: editOf,
    text,
    setText,
    diffOnly,
    setDiffOnly,
    /** 押したリポジトリの値を基準にする。もう一度押すと、いちばん多い値に戻す */
    toggleReference: (rowKey: string, columnKey: string) =>
      editRow(rowKey, (e) => ({ ...e, reference: e.reference === columnKey ? undefined : columnKey })),
    /** 名前の変更を決める。undefined で取り消す */
    setRename: (rowKey: string, name: string | undefined) => editRow(rowKey, (e) => ({ ...e, renameTo: name })),
    isSelected: (key: string) => selected().has(key),
    toggle: (key: string) =>
      setSelected((s) => {
        const next = new Set(s);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    selectShown: (checked: boolean) =>
      setSelected((s) => {
        const next = new Set(s);
        for (const r of rows()) {
          if (checked) next.add(r.key);
          else next.delete(r.key);
        }
        return next;
      }),
    selectedCount: () => selectedKeys().length,
    selectedShown: () => rows().filter((r) => selected().has(r.key)).length,
    clearSelection: () => setSelected(new Set<string>()),
    add,
    setAdd,
    update,
    setUpdate,
    plan,
    phase,
    review: () => plan().changes.length > 0 && setPhase({ phase: "confirm" }),
    cancel: () => setPhase({ phase: "idle" }),
    apply,
    notice,
    dismissNotice: () => setNotice(null),
  };
}

export type LabelsState = ReturnType<typeof createLabelsState>;

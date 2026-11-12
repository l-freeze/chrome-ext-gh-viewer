// リポジトリの設定の違いの表の状態: 取得、違いのある設定だけの絞り込み、リポジトリ名での絞り込み、並べ替え、
// 行ごとの公開範囲と既定のブランチの変更。
// 公開範囲は 2 段階の確認（影響の確認 → リポジトリ名の入力）、既定のブランチは 1 回の確認を経てから送る。
// 変更の欄を開いている間は取り直さない。
// 並べ替えは複数の列で行い、押した順に優先する。見出しを押すたびに昇順 → 降順 → 解除。何も無ければリポジトリ名の昇順。

import { batch, createMemo, createSignal, type Accessor } from "solid-js";
import type { Visibility } from "../../../features/repo-settings/ports";
import { compareSettings, cycleSort, rowDiffers, sortRows, type SettingsSort, type SettingsSortKey } from "../../../features/repo-settings/comparison";
import type { RepoSettings } from "../../../features/repo-settings/settings";
import { repoKey, toRepoRef, type Repository } from "../../../features/workspace/repository";
import type { UiDeps } from "../../app/context";
import type { WorkspaceState } from "../../app/workspace";
import { createRepoResults } from "../../lists/repo-results";

/** 変更の欄の状態。repo は変えるリポジトリ、current は開いたときの設定 */
export type EditState = { repo: Repository; current: RepoSettings } & (
  | { phase: "menu"; branches: { status: "loading" } | { status: "ready"; names: string[] } | { status: "failed"; error: unknown }; branch: string }
  | { phase: "visibilityWarn"; to: Visibility }
  | { phase: "visibilityConfirm"; to: Visibility; typed: string }
  | { phase: "branchConfirm"; from: string; to: string }
  | { phase: "saving" }
);

export type EditNotice =
  | { kind: "visibilityChanged"; repo: string; to: Visibility }
  | { kind: "branchChanged"; repo: string; to: string }
  | { kind: "failed"; repo: string; error: unknown };

export function createRepoSettingsState(deps: UiDeps, ws: WorkspaceState, active: Accessor<boolean>) {
  const ops = deps.manager.repoSettings;
  const [text, setText] = createSignal("");
  const [diffOnly, setDiffOnly] = createSignal(true);
  const [sort, setSort] = createSignal<SettingsSort>([]);
  const [edit, setEdit] = createSignal<EditState | null>(null);
  const [notice, setNotice] = createSignal<EditNotice | null>(null);

  const results = createRepoResults<RepoSettings | null>({
    ws,
    fetch: (repos, options) => ops.list(repos, options),
    now: deps.manager.now,
    active,
    onReset: () => setEdit(null),
    paused: (): boolean => edit() !== null,
  });

  // アーカイブ済みのリポジトリ（null）は表に出さない
  const comparison = createMemo(() => compareSettings(results.values().flatMap((r) => (r.value ? [r.value] : []))));
  const columns = createMemo(() => comparison().columns.filter((c) => !diffOnly() || !c.uniform));
  const rows = createMemo(() => {
    const terms = text().toLowerCase().split(/\s+/).filter(Boolean);
    const shown = comparison().rows.filter((r) => terms.every((t) => repoKey(r.repo).toLowerCase().includes(t)));
    return sortRows(shown, sort());
  });

  const repositoryOf = (settings: RepoSettings) => results.values().find((r) => repoKey(toRepoRef(r.repo)) === repoKey(settings.repo))?.repo ?? null;
  const currentVisibility = (settings: RepoSettings): Visibility | null => {
    const v = settings.values.visibility;
    return v.kind === "value" && (v.value === "public" || v.value === "private") ? v.value : null;
  };
  const currentBranch = (settings: RepoSettings): string | null => {
    const v = settings.values.defaultBranch;
    return v.kind === "value" && typeof v.value === "string" ? v.value : null;
  };

  /** 行の「変更」を押した: 欄を開き、既定のブランチの選択肢を読む */
  async function open(settings: RepoSettings) {
    const repo = repositoryOf(settings);
    if (!repo || (edit() && edit()!.phase !== "menu")) return;
    setNotice(null);
    const branch = currentBranch(settings) ?? "";
    setEdit({ repo, current: settings, phase: "menu", branches: { status: "loading" }, branch });
    try {
      const names = await ops.listBranches(repo);
      setEdit((e) => (e && e.repo === repo && e.phase === "menu" ? { ...e, branches: { status: "ready", names } } : e));
    } catch (error) {
      setEdit((e) => (e && e.repo === repo && e.phase === "menu" ? { ...e, branches: { status: "failed", error } } : e));
    }
  }

  async function save(run: (repo: Repository) => Promise<RepoSettings>, done: EditNotice) {
    const e = edit();
    if (!e) return;
    const repo = e.repo;
    setEdit({ repo, current: e.current, phase: "saving" });
    try {
      await run(repo);
      batch(() => {
        setEdit(null);
        setNotice(done);
      });
    } catch (error) {
      batch(() => {
        setEdit(null);
        setNotice({ kind: "failed", repo: repo.fullName, error });
      });
    }
    // 変えたかどうかにかかわらず、そのリポジトリを取り直して表を今の状態にする
    results.reload([repo]);
  }

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
    edit,
    notice,
    dismissNotice: () => setNotice(null),
    currentVisibility,
    currentBranch,
    open,
    close: () => setEdit(null),
    chooseBranch: (branch: string) => setEdit((e) => (e && e.phase === "menu" ? { ...e, branch } : e)),
    /** 公開範囲の 1 段目: 今と反対の公開範囲にする */
    askVisibility: () => {
      const e = edit();
      const now = e && e.phase === "menu" ? currentVisibility(e.current) : null;
      if (!e || !now) return;
      setEdit({ repo: e.repo, current: e.current, phase: "visibilityWarn", to: now === "public" ? "private" : "public" });
    },
    /** 公開範囲の 2 段目へ（影響を確かめた） */
    acknowledgeVisibility: () => {
      const e = edit();
      if (e?.phase === "visibilityWarn") setEdit({ repo: e.repo, current: e.current, phase: "visibilityConfirm", to: e.to, typed: "" });
    },
    typeName: (typed: string) => setEdit((e) => (e && e.phase === "visibilityConfirm" ? { ...e, typed } : e)),
    /** 2 段目で、リポジトリ名（owner/name）を正しく入力したか */
    nameMatches: () => {
      const e = edit();
      return e?.phase === "visibilityConfirm" && e.typed.trim() === e.repo.fullName;
    },
    async changeVisibility() {
      const e = edit();
      if (e?.phase !== "visibilityConfirm" || e.typed.trim() !== e.repo.fullName) return;
      const to = e.to;
      await save((repo) => ops.setVisibility(repo, to), { kind: "visibilityChanged", repo: e.repo.fullName, to });
    },
    /** 既定のブランチの確認へ（選んだブランチが今と違うときだけ） */
    askBranch: () => {
      const e = edit();
      if (e?.phase !== "menu") return;
      const from = currentBranch(e.current) ?? "";
      if (e.branches.status !== "ready" || !e.branches.names.includes(e.branch) || e.branch === from) return;
      setEdit({ repo: e.repo, current: e.current, phase: "branchConfirm", from, to: e.branch });
    },
    async changeBranch() {
      const e = edit();
      if (e?.phase !== "branchConfirm") return;
      const to = e.to;
      await save((repo) => ops.setDefaultBranch(repo, to), { kind: "branchChanged", repo: e.repo.fullName, to });
    },
    toggleSort: (key: SettingsSortKey) => setSort((s) => cycleSort(s, key)),
    resetSort: () => setSort([]),
    differingSettings: createMemo(() => comparison().columns.filter((c) => !c.uniform).length),
    differingRepos: createMemo(() => comparison().rows.filter((r) => rowDiffers(r, comparison().columns)).length),
  };
}

export type RepoSettingsState = ReturnType<typeof createRepoSettingsState>;

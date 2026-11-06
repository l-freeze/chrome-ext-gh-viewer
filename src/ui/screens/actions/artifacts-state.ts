// Actions のタブの「アーティファクト」パネルの状態（閲覧とダウンロードのみ）。
// Artifacts のタブが読み込んだアーティファクトを、Actions の一覧が持つ最近の実行でワークフローごとにまとめる。
// 最近の実行（1 ページ分）にない古い実行だけ、その実行を 1 回読んでワークフローを調べ、結果は覚えておく。

import { batch, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import type { WorkflowRun, WorkflowWithRun } from "../../../features/actions/workflow";
import type { Artifact } from "../../../features/artifacts/artifact";
import { toRepoRef, type Repository } from "../../../features/workspace/repository";
import { mapWithConcurrency } from "../../../lib/concurrency";
import type { UiDeps } from "../../app/context";

export interface ArtifactRunGroup {
  runId: number | null;
  /** 実行の情報。分からなければ null */
  run: WorkflowRun | null;
  artifacts: Artifact[];
}

export interface ArtifactWorkflowGroup {
  /** ワークフローの ID。実行が分からなければ null（「ワークフロー不明」） */
  workflowId: number | null;
  name: string | null;
  htmlUrl: string | null;
  runs: ArtifactRunGroup[];
}

export interface ArtifactRepoGroup {
  repo: Repository;
  workflows: ArtifactWorkflowGroup[];
}

export type ArtifactPanelNotice =
  | { kind: "downloadStarted"; name: string }
  | { kind: "downloadFailed"; name: string; reason: string }
  | { kind: "error"; error: unknown };

type RepoValues<T> = Accessor<Array<{ repo: Repository; value: T }>>;

const runKey = (repoId: number, runId: number) => `${repoId}:${runId}`;
const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);

export function createWorkflowArtifactsState(
  deps: UiDeps,
  sources: { artifacts: RepoValues<Artifact[]>; workflows: RepoValues<WorkflowWithRun[]> },
) {
  const [text, setText] = createSignal("");
  // 古い実行を読んだ結果（見つからなかった・読めなかったものは null）
  const [resolved, setResolved] = createSignal<ReadonlyMap<string, WorkflowRun | null>>(new Map());
  const [resolving, setResolving] = createSignal(0);
  const [notice, setNotice] = createSignal<ArtifactPanelNotice | null>(null);
  const pending = new Set<string>();

  /** 最近の実行（追加の呼び出しなしで分かるもの） */
  const knownRuns = createMemo(() => {
    const known = new Map<string, WorkflowRun>();
    for (const { repo, value } of sources.workflows()) {
      for (const w of value) for (const run of [...w.recentRuns, ...(w.lastRun ? [w.lastRun] : [])]) known.set(runKey(repo.id, run.id), run);
    }
    return known;
  });

  /** ワークフローの一覧を読み込めたリポジトリ（古い実行を調べるのはこれらだけ） */
  const loadedRepos = createMemo(() => new Map(sources.workflows().map(({ repo, value }) => [repo.id, value])));

  const runOf = (repo: Repository, runId: number | null): WorkflowRun | null =>
    runId === null ? null : (knownRuns().get(runKey(repo.id, runId)) ?? resolved().get(runKey(repo.id, runId)) ?? null);

  /** まだワークフローが分からない古い実行 */
  const unknownRuns = createMemo(() => {
    const list: Array<{ repo: Repository; runId: number }> = [];
    for (const { repo, value } of sources.artifacts()) {
      if (!loadedRepos().has(repo.id)) continue;
      for (const runId of new Set(value.map((a) => a.workflowRun?.id ?? null))) {
        if (runId === null) continue;
        const key = runKey(repo.id, runId);
        if (!knownRuns().has(key) && !resolved().has(key) && !pending.has(key)) list.push({ repo, runId });
      }
    }
    return list;
  });

  /** 古い実行を 1 回ずつ読んでワークフローを調べる（同じ実行は 2 回読まない） */
  async function resolveUnknownRuns() {
    // 読んでいる途中のものは除く（pending は画面の更新に使わないので、ここで確かめる）
    const targets = unknownRuns().filter((u) => !pending.has(runKey(u.repo.id, u.runId)));
    if (targets.length === 0) return;
    for (const t of targets) pending.add(runKey(t.repo.id, t.runId));
    setResolving((n) => n + targets.length);
    await mapWithConcurrency(targets, 4, async ({ repo, runId }) => {
      let run: WorkflowRun | null = null;
      try {
        run = await deps.manager.actions.readRun(toRepoRef(repo), runId);
      } catch {
        // 読めなければ「ワークフロー不明」のまま
      }
      batch(() => {
        setResolved((m) => new Map(m).set(runKey(repo.id, runId), run));
        setResolving((n) => n - 1);
      });
    });
  }

  const groups = createMemo((): ArtifactRepoGroup[] => {
    const terms = text().toLowerCase().split(/\s+/).filter(Boolean);
    const result: ArtifactRepoGroup[] = [];
    for (const { repo, value } of sources.artifacts()) {
      const workflows = loadedRepos().get(repo.id) ?? [];
      const byWorkflow = new Map<number | null, ArtifactWorkflowGroup>();
      for (const artifact of value) {
        const runId = artifact.workflowRun?.id ?? null;
        const run = runOf(repo, runId);
        const workflow = run ? workflows.find((w) => w.workflow.id === run.workflowId)?.workflow : undefined;
        const name = workflow?.name ?? run?.name ?? null;
        const haystack = [artifact.name, name ?? "", artifact.workflowRun?.headBranch ?? "", repo.fullName].join("\n").toLowerCase();
        if (!terms.every((t) => haystack.includes(t))) continue;
        const workflowId = run?.workflowId ?? null;
        const group = byWorkflow.get(workflowId) ?? { workflowId, name, htmlUrl: workflow?.htmlUrl ?? null, runs: [] };
        byWorkflow.set(workflowId, group);
        const runGroup = group.runs.find((r) => r.runId === runId) ?? { runId, run, artifacts: [] };
        if (!group.runs.includes(runGroup)) group.runs.push(runGroup);
        runGroup.artifacts.push(artifact);
      }
      if (byWorkflow.size === 0) continue;
      const list = [...byWorkflow.values()];
      for (const w of list) {
        w.runs.sort((a, b) => time(b.run?.createdAt ?? b.artifacts[0]?.createdAt) - time(a.run?.createdAt ?? a.artifacts[0]?.createdAt));
        for (const r of w.runs) r.artifacts.sort((a, b) => a.name.localeCompare(b.name));
      }
      // ワークフロー名の順。分からないものは最後
      list.sort((a, b) => (a.name === null ? 1 : b.name === null ? -1 : a.name.localeCompare(b.name)));
      result.push({ repo, workflows: list });
    }
    return result.sort((a, b) => a.repo.fullName.localeCompare(b.repo.fullName));
  });

  // 開始したダウンロードの ID → アーティファクト。中断の通知を受けたら名前を示すために使う
  const downloading = new Map<number, Artifact>();
  onCleanup(
    deps.manager.artifacts.onDownloadInterrupted((id, reason) => {
      const artifact = downloading.get(id);
      if (!artifact) return;
      downloading.delete(id);
      setNotice({ kind: "downloadFailed", name: artifact.name, reason });
    }),
  );

  async function download(artifact: Artifact) {
    try {
      downloading.set(await deps.manager.artifacts.download(artifact), artifact);
      setNotice({ kind: "downloadStarted", name: artifact.name });
    } catch (error) {
      setNotice({ kind: "error", error });
    }
  }

  return {
    text,
    setText,
    groups,
    count: createMemo(() => groups().reduce((n, g) => n + g.workflows.reduce((m, w) => m + w.runs.reduce((k, r) => k + r.artifacts.length, 0), 0), 0)),
    unknownRuns,
    resolveUnknownRuns,
    resolving,
    download,
    notice,
    dismissNotice: () => setNotice(null),
  };
}

export type WorkflowArtifactsState = ReturnType<typeof createWorkflowArtifactsState>;

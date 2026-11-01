import type { Settled, SettleOptions } from "../../lib/concurrency";
import type { RepoRef, Repository } from "../workspace/repository";
import type { RunCleanupCriteria } from "./cleanup";
import type { DispatchInput, DispatchSpec } from "./dispatch";
import type { Workflow, WorkflowRun, WorkflowWithRun } from "./workflow";

export interface DispatchTarget {
  repo: Repository;
  workflow: Workflow;
}

export interface DispatchPreparation {
  spec: DispatchSpec;
  branches: string[];
  /** Environment の一覧。取得できなければ null（自由入力にする） */
  environments: string[] | null;
  /** 最初に選んでおくブランチ */
  ref: string;
}

/** 画面で入力された実行の依頼。dispatch はこれを検証してから実行する */
export interface DispatchRequest {
  target: DispatchTarget;
  ref: string;
  inputs: readonly DispatchInput[];
  values: Readonly<Record<string, string>>;
  environments: readonly string[] | null;
}

export type DispatchInputError = "required" | "number" | "choice";

export type DispatchReview =
  | { ok: true; inputs: Record<string, string> }
  | { ok: false; errors: Record<string, DispatchInputError>; refMissing: boolean };

export interface RunSearchResult {
  runs: WorkflowRun[];
  /** 1,000 件を超えていて、残りは返っていない */
  truncated: boolean;
}

/** 実行を依頼して作られた実行。GitHub が返さなかったときは null で表す */
export interface DispatchedRun {
  id: number;
  htmlUrl: string;
}

/** 画面から呼ぶ操作 */
export interface ActionsOperations {
  /** リポジトリごとにワークフローと最新の実行を集める */
  list(repos: readonly Repository[], options?: SettleOptions<Repository, WorkflowWithRun[]>): Promise<Settled<Repository, WorkflowWithRun[]>[]>;
  /** ワークフローごとの最新の実行を取り直す（ワークフロー一覧は取り直さない） */
  latestRuns(repo: Repository): Promise<Map<number, WorkflowRun>>;
  /** 手動実行の画面を開く準備（ブランチ・Environment・既定のブランチの定義） */
  prepareDispatch(target: DispatchTarget): Promise<DispatchPreparation>;
  /** 指定したブランチの定義を読む（入力の定義はブランチごとに違いうる） */
  readDispatchSpec(target: DispatchTarget, ref: string): Promise<DispatchSpec>;
  /** 実行の前の確認用。入力を検証し、誤りか、送る値を返す（実行はしない） */
  reviewDispatch(request: DispatchRequest): DispatchReview;
  /** 入力を検証してから実行を依頼する（入力は DispatchRequest の形）。作られた実行が分かればそれを返す */
  dispatch(request: unknown): Promise<DispatchedRun | null>;
  /** 1 つの実行の今の状態。まだ見えない（作られた直後など）ときは null */
  readRun(repo: RepoRef, runId: number): Promise<WorkflowRun | null>;
  searchRuns(
    repos: readonly Repository[],
    criteria: RunCleanupCriteria,
    options?: SettleOptions<Repository, RunSearchResult>,
  ): Promise<Settled<Repository, RunSearchResult>[]>;
  /** 1 件ずつ削除する。すでに消えているものは成功とみなす */
  removeRuns(runs: readonly WorkflowRun[], options?: SettleOptions<WorkflowRun, void>): Promise<Settled<WorkflowRun, void>[]>;
}

export interface ActionsSource {
  listWorkflows(repo: RepoRef, signal?: AbortSignal): Promise<Workflow[]>;
  listRecentRuns(repo: RepoRef, signal?: AbortSignal): Promise<WorkflowRun[]>;
  readWorkflowFile(repo: RepoRef, path: string, ref: string): Promise<string>;
  listBranches(repo: RepoRef): Promise<string[]>;
  listEnvironments(repo: RepoRef): Promise<string[]>;
  dispatch(repo: RepoRef, workflowId: number, ref: string, inputs: Record<string, string>): Promise<DispatchedRun | null>;
  /** 見つからなければ null */
  readRun(repo: RepoRef, runId: number): Promise<WorkflowRun | null>;
  searchRuns(repo: RepoRef, filter: { created: string; status: string }, maxResults: number, signal?: AbortSignal): Promise<RunSearchResult>;
  removeRun(run: WorkflowRun, signal?: AbortSignal): Promise<void>;
}

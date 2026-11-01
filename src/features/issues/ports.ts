import type { Owner } from "../workspace/repository";
import type { Issue } from "./issue";

export type IssueStateFilter = "open" | "closed" | "all";

export interface OwnerIssues {
  owner: Owner;
  issues: Issue[];
  /** 検索の上限で取りきれなかった */
  truncated: boolean;
  error: unknown | null;
}

/** 画面から呼ぶ操作 */
export interface IssueOperations {
  /** 所有者ごとに検索する。Search API のレート制限が厳しいので 1 つずつ順に行う */
  search(
    owners: readonly Owner[],
    state: IssueStateFilter,
    options?: { signal?: AbortSignal; onOwnerDone?: (result: OwnerIssues) => void },
  ): Promise<OwnerIssues[]>;
}

export interface IssueSource {
  searchOwner(owner: Owner, state: IssueStateFilter, signal?: AbortSignal): Promise<{ issues: Issue[]; truncated: boolean }>;
}

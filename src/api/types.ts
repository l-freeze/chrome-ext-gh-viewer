// GitHub REST API の入出力型。
// Raw* は API が返す JSON のうち、この拡張が使うフィールドだけを抜き出したもの。
// それ以外は decode.ts で検証・変換したあとのドメイン型で、UI 層はこちらだけを扱う。

// ---------------------------------------------------------------------------
// Raw（API レスポンス）
// ---------------------------------------------------------------------------

export interface RawSimpleUser {
  login: string;
  id: number;
  type: string;
  avatar_url: string;
  html_url: string;
}

export interface RawOrganization {
  login: string;
  id: number;
  avatar_url: string;
  description: string | null;
}

export interface RawRepository {
  id: number;
  name: string;
  full_name: string;
  owner: RawSimpleUser;
  private: boolean;
  archived: boolean;
  html_url: string;
  pushed_at: string | null;
  default_branch?: string;
}

export interface RawArtifact {
  id: number;
  name: string;
  size_in_bytes: number;
  expired: boolean;
  created_at: string | null;
  expires_at: string | null;
  updated_at: string | null;
  digest?: string | null;
  workflow_run?: {
    id?: number;
    head_branch?: string;
    head_sha?: string;
  } | null;
}

export interface RawArtifactList {
  total_count: number;
  artifacts: RawArtifact[];
}

export interface RawLabel {
  name: string;
  color: string | null;
  description: string | null;
}

export interface RawIssue {
  id: number;
  number: number;
  title: string;
  state: string;
  state_reason?: string | null;
  html_url: string;
  repository_url: string;
  user: RawSimpleUser | null;
  labels: Array<RawLabel | string>;
  assignees?: RawSimpleUser[] | null;
  comments: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  pull_request?: unknown;
}

export interface RawIssueSearchResult {
  total_count: number;
  incomplete_results: boolean;
  items: RawIssue[];
}

export interface RawDeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export type RawAccessTokenResponse =
  | { access_token: string; token_type: string; scope: string }
  | { error: string; error_description?: string; interval?: number };

// ---------------------------------------------------------------------------
// ドメイン型
// ---------------------------------------------------------------------------

export type OwnerType = "User" | "Organization";

export interface Owner {
  login: string;
  id: number;
  type: OwnerType;
  avatarUrl: string;
}

export interface UserRef {
  login: string;
  avatarUrl: string;
}

export interface RepoRef {
  owner: string;
  name: string;
}

export interface Repository {
  id: number;
  owner: Owner;
  name: string;
  fullName: string;
  private: boolean;
  archived: boolean;
  htmlUrl: string;
  pushedAt: string | null;
  /** 既定のブランチ。API が返さなければ null */
  defaultBranch: string | null;
}

export interface WorkflowRunRef {
  id: number | null;
  headBranch: string | null;
  headSha: string | null;
}

export interface Artifact {
  id: number;
  repo: RepoRef;
  name: string;
  sizeInBytes: number;
  expired: boolean;
  createdAt: string | null;
  expiresAt: string | null;
  updatedAt: string | null;
  digest: string | null;
  workflowRun: WorkflowRunRef | null;
}

export interface Workflow {
  id: number;
  repo: RepoRef;
  name: string;
  /** .github/workflows/ci.yml など。GitHub が内部で動かすものは dynamic/... になる */
  path: string;
  /** active / disabled_manually / disabled_inactivity など */
  state: string;
  htmlUrl: string;
}

export interface ActionsCache {
  id: number;
  repo: RepoRef;
  /** refs/heads/main、refs/pull/12/merge など */
  ref: string;
  key: string;
  version: string | null;
  sizeInBytes: number;
  lastAccessedAt: string | null;
  createdAt: string | null;
}

export interface WorkflowRun {
  id: number;
  workflowId: number;
  repo: RepoRef;
  /** ワークフロー名 */
  name: string | null;
  /** 実行の表示名（コミットメッセージや PR のタイトル） */
  displayTitle: string | null;
  runNumber: number;
  /** queued / in_progress / completed など */
  status: string | null;
  /** success / failure / cancelled など。完了前は null */
  conclusion: string | null;
  event: string;
  headBranch: string | null;
  actor: UserRef | null;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface Label {
  name: string;
  /** 先頭の # を含まない 6 桁の 16 進数。不明なら null。 */
  color: string | null;
  description: string | null;
}

export type IssueState = "open" | "closed";

export interface Issue {
  id: number;
  number: number;
  repo: RepoRef;
  title: string;
  state: IssueState;
  stateReason: string | null;
  htmlUrl: string;
  author: UserRef | null;
  labels: Label[];
  assignees: UserRef[];
  comments: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface RateLimit {
  limit: number;
  remaining: number;
  used: number;
  /** リセット時刻（UNIX 秒） */
  reset: number;
  resource: string;
}

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface AccessToken {
  accessToken: string;
  tokenType: string;
  scopes: string[];
}

export type TokenKind =
  | "classic-pat"
  | "fine-grained-pat"
  | "oauth"
  | "github-app-user"
  | "unknown";

export interface TokenInfo {
  kind: TokenKind;
  user: Owner;
  /** Classic PAT / OAuth トークンのスコープ。Fine-grained PAT では null。 */
  scopes: string[] | null;
  /** トークンの有効期限（ISO 8601）。期限なし・不明なら null。 */
  expiresAt: string | null;
}

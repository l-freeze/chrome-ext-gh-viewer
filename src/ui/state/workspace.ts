// アクセスできる所有者・リポジトリと、画面で選んでいる所有者。

import { createMemo, createResource, createSignal, type Accessor } from "solid-js";
import type { Credential } from "../../services/credentials";
import {
  createClientRouter,
  discoverWorkspace,
  type ClientRouter,
  type OwnerEntry,
  type RepoEntry,
  type Workspace,
} from "../../services/workspace";
import type { AppDeps } from "./context";

const HIDDEN_OWNERS_KEY = "hiddenOwners";

export interface WorkspaceState {
  workspace: Accessor<Workspace | undefined>;
  loading: Accessor<boolean>;
  error: Accessor<unknown>;
  router: Accessor<ClientRouter | undefined>;
  owners: Accessor<OwnerEntry[]>;
  isOwnerSelected(login: string): boolean;
  toggleOwner(login: string): void;
  selectedOwners: Accessor<OwnerEntry[]>;
  selectedRepos: Accessor<RepoEntry[]>;
  reload(): void;
}

export function createWorkspaceState(deps: AppDeps, credentials: Accessor<Credential[]>): WorkspaceState {
  const clientFor = (c: Credential) => deps.createClient(c.token);

  const [workspace, { refetch }] = createResource(
    () => (credentials().length > 0 ? credentials() : false),
    (creds) => discoverWorkspace(creds, clientFor),
  );

  // 選択を外した所有者だけを覚える。新しく見つかった所有者は最初から選択された状態になる
  const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set());
  void deps.store.get<string[]>(HIDDEN_OWNERS_KEY).then((list) => setHidden(new Set(list ?? [])));

  const router = createMemo(() => {
    const ws = workspace.latest;
    return ws ? createClientRouter(ws, credentials(), clientFor) : undefined;
  });

  const owners = createMemo(() => (credentials().length > 0 ? (workspace.latest?.owners ?? []) : []));
  const isOwnerSelected = (login: string) => !hidden().has(login.toLowerCase());
  const selectedOwners = createMemo(() => owners().filter((o) => isOwnerSelected(o.owner.login)));
  const selectedRepos = createMemo(() => {
    const logins = new Set(selectedOwners().map((o) => o.owner.login.toLowerCase()));
    return (workspace.latest?.repos ?? []).filter((r) => logins.has(r.repo.owner.login.toLowerCase()));
  });

  return {
    workspace: () => (credentials().length > 0 ? workspace.latest : undefined),
    loading: () => workspace.loading,
    error: () => workspace.error,
    router,
    owners,
    isOwnerSelected,
    toggleOwner(login) {
      const key = login.toLowerCase();
      const next = new Set(hidden());
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setHidden(next);
      void deps.store.set(HIDDEN_OWNERS_KEY, [...next]);
    },
    selectedOwners,
    selectedRepos,
    reload: () => void refetch(),
  };
}

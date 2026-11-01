// 作業範囲（アクセスできる所有者・リポジトリ）と、画面で選んでいる所有者。

import { createMemo, createResource, createSignal, type Accessor } from "solid-js";
import { isBroad, type Credential } from "../../features/settings/credential";
import type { OwnerEntry, RepoEntry, Workspace } from "../../features/workspace/repository";
import type { UiDeps } from "./context";

export interface WorkspaceState {
  workspace: Accessor<Workspace | undefined>;
  loading: Accessor<boolean>;
  error: Accessor<unknown>;
  owners: Accessor<OwnerEntry[]>;
  isOwnerSelected(login: string): boolean;
  toggleOwner(login: string): void;
  selectedOwners: Accessor<OwnerEntry[]>;
  selectedRepos: Accessor<RepoEntry[]>;
  reload(): void;
}

export function createWorkspaceState(deps: UiDeps, credentials: Accessor<Credential[]>): WorkspaceState {
  const { manager } = deps;

  const [workspace, { refetch }] = createResource(
    () => (credentials().length > 0 ? credentials() : false),
    async (creds) => {
      const tokens = creds.map((c) => ({ id: c.id, token: c.token }));
      manager.access.update(tokens);
      const ws = await manager.workspace.discover(creds.map((c) => ({ id: c.id, login: c.login, avatarUrl: c.avatarUrl, broad: isBroad(c) })));
      // どのリポジトリをどの認証情報で呼ぶかを知らせる
      manager.access.update(tokens, ws);
      return ws;
    },
  );

  // 選択を外した所有者（小文字）。新しく見つかった所有者は最初から選択された状態になる
  const [hidden, setHidden] = createSignal<readonly string[]>([]);
  void manager.workspace.loadHiddenOwners().then(setHidden, () => setHidden([]));

  const current = () => (credentials().length > 0 ? workspace.latest : undefined);
  const owners = createMemo(() => current()?.owners ?? []);
  const isOwnerSelected = (login: string) => !hidden().includes(login.toLowerCase());
  const selectedOwners = createMemo(() => owners().filter((o) => isOwnerSelected(o.owner.login)));
  const selectedRepos = createMemo(() => {
    const logins = new Set(selectedOwners().map((o) => o.owner.login.toLowerCase()));
    return (current()?.repos ?? []).filter((r) => logins.has(r.repo.owner.login.toLowerCase()));
  });

  return {
    workspace: current,
    loading: () => workspace.loading,
    error: () => workspace.error,
    owners,
    isOwnerSelected,
    toggleOwner(login) {
      void manager.workspace.toggleOwner(hidden(), login).then(setHidden);
    },
    selectedOwners,
    selectedRepos,
    reload: () => void refetch(),
  };
}

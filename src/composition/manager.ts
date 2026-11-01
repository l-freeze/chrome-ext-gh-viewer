// 管理画面で使う各機能を、具体的な実装（GitHub・chrome の保存先とダウンロード）でつなぐ。

import { createActionsFeature } from "../features/actions/compose";
import { createGitHubActionsSource } from "../features/actions/gateways/github";
import type { Downloader } from "../features/artifacts/ports";
import { createArtifactsFeature } from "../features/artifacts/compose";
import { createGitHubArtifactSource } from "../features/artifacts/gateways/github";
import { createCachesFeature } from "../features/caches/compose";
import { createGitHubCacheSource } from "../features/caches/gateways/github";
import { createIssuesFeature } from "../features/issues/compose";
import { createGitHubIssueSource } from "../features/issues/gateways/github";
import { createProjectsFeature } from "../features/projects/compose";
import { createGitHubProjectSource } from "../features/projects/gateways/github";
import { createBoardPreferencesStorage } from "../features/projects/gateways/storage";
import { createSettingsFeature } from "../features/settings/compose";
import { createGitHubDeviceAuthorizer, createGitHubTokenInspector } from "../features/settings/gateways/github";
import { createCredentialStorage } from "../features/settings/gateways/storage";
import { createWorkspaceFeature } from "../features/workspace/compose";
import { createGitHubRepositorySource } from "../features/workspace/gateways/github";
import { createOwnerSelectionStorage } from "../features/workspace/gateways/storage";
import { createHttpClient } from "../infrastructure/http";
import type { StorageDriver } from "../infrastructure/storage/contracts";
import { DeviceFlow } from "../integrations/github/device-flow";
import { GitHubHttp } from "../integrations/github/http";
import { createGitHubAccess } from "./github-access";

export interface ManagerEnvironment {
  storage: StorageDriver;
  downloads: Downloader;
  /** OAuth App の Client ID。ないビルドでは null（GitHub でログインは使えない） */
  oauthClientId: string | null;
  fetch?: typeof fetch;
  now?: () => number;
}

export function createManager(env: ManagerEnvironment) {
  const now = env.now ?? (() => Date.now());
  const client = createHttpClient(env.fetch ? { fetch: env.fetch } : {});
  const httpFor = (token: string) => new GitHubHttp({ token, client });
  const access = createGitHubAccess(httpFor);

  return {
    /** 認証情報と作業範囲が変わったら知らせる */
    access: { update: access.update },
    settings: createSettingsFeature({
      repository: createCredentialStorage(env.storage),
      inspector: createGitHubTokenInspector(httpFor),
      authorizer: env.oauthClientId ? createGitHubDeviceAuthorizer(new DeviceFlow({ clientId: env.oauthClientId, client })) : null,
    }),
    workspace: createWorkspaceFeature({
      source: createGitHubRepositorySource((id) => access.forIdentity(id)),
      selection: createOwnerSelectionStorage(env.storage),
    }),
    artifacts: createArtifactsFeature({ source: createGitHubArtifactSource((r) => access.forRepo(r)), downloader: env.downloads }),
    caches: createCachesFeature({ source: createGitHubCacheSource((r) => access.forRepo(r)) }),
    actions: createActionsFeature({ source: createGitHubActionsSource((r) => access.forRepo(r)), now }),
    issues: createIssuesFeature({ source: createGitHubIssueSource((login) => access.forOwner(login)) }),
    projects: createProjectsFeature({
      source: createGitHubProjectSource((login) => access.forOwner(login)),
      preferences: createBoardPreferencesStorage(env.storage),
    }),
    now,
  };
}

export type Manager = ReturnType<typeof createManager>;

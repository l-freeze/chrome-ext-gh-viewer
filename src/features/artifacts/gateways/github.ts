import { artifactZipRequest, deleteArtifact, listArtifacts, type GitHubArtifact } from "../../../integrations/github/artifacts";
import { isGitHubApiError } from "../../../integrations/github/errors";
import type { GitHubHttp } from "../../../integrations/github/http";
import type { RepoRef } from "../../workspace/repository";
import type { Artifact } from "../artifact";
import type { ArtifactSource } from "../ports";

export function toArtifact(a: GitHubArtifact, repo: RepoRef): Artifact {
  return {
    id: a.id,
    repo,
    name: a.name,
    sizeInBytes: a.size_in_bytes,
    expired: a.expired,
    createdAt: a.created_at,
    expiresAt: a.expires_at,
    updatedAt: a.updated_at,
    digest: a.digest,
    workflowRun: a.workflow_run && { id: a.workflow_run.id, headBranch: a.workflow_run.head_branch, headSha: a.workflow_run.head_sha },
  };
}

/** httpFor: リポジトリから、そのリポジトリを見られるトークンのクライアントを返す */
export function createGitHubArtifactSource(httpFor: (repo: RepoRef) => GitHubHttp): ArtifactSource {
  return {
    async list(repo, signal) {
      return (await listArtifacts(httpFor(repo), repo, signal ? { signal } : {})).map((a) => toArtifact(a, repo));
    },
    async remove(item, signal) {
      try {
        await deleteArtifact(httpFor(item.repo), item.repo, item.id, signal ? { signal } : {});
      } catch (e) {
        // すでに消えているなら目的は果たしている
        if (!isGitHubApiError(e, "not_found")) throw e;
      }
    },
    downloadRequest: (item) => artifactZipRequest(httpFor(item.repo), item.repo, item.id),
  };
}

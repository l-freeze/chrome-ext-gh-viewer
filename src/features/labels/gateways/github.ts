import { isGitHubApiError } from "../../../integrations/github/errors";
import type { GitHubHttp } from "../../../integrations/github/http";
import { createLabel, deleteLabel, listLabels, updateLabel, type GitHubLabel } from "../../../integrations/github/labels";
import type { RepoRef } from "../../workspace/repository";
import type { Label, LabelValue } from "../label";
import type { LabelSource } from "../ports";

export function toLabel(l: GitHubLabel, repo: RepoRef): Label {
  return { repo, name: l.name, color: l.color.toLowerCase(), description: l.description ?? "" };
}

const toInput = (v: LabelValue) => ({ name: v.name, color: v.color.toLowerCase(), description: v.description });

export function createGitHubLabelSource(httpFor: (repo: RepoRef) => GitHubHttp): LabelSource {
  const call = (signal?: AbortSignal) => (signal ? { signal } : {});
  return {
    list: async (repo, signal) => (await listLabels(httpFor(repo), repo, call(signal))).map((l) => toLabel(l, repo)),
    create: async (repo, value, signal) => toLabel(await createLabel(httpFor(repo), repo, toInput(value), call(signal)), repo),
    update: async (repo, currentName, value, signal) => toLabel(await updateLabel(httpFor(repo), repo, currentName, toInput(value), call(signal)), repo),
    async remove(repo, name, signal) {
      try {
        await deleteLabel(httpFor(repo), repo, name, call(signal));
      } catch (e) {
        // すでに消えている（ほかで削除された）なら、削除できたとみなす
        if (isGitHubApiError(e, "not_found")) return;
        throw e;
      }
    },
  };
}

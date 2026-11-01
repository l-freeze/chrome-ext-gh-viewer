import {
  deleteRun,
  dispatchWorkflow,
  getRun,
  listRecentRuns,
  listWorkflows,
  searchRuns,
  type GitHubRun,
  type GitHubWorkflow,
} from "../../../integrations/github/actions";
import { getFileText, listBranches, listEnvironments } from "../../../integrations/github/contents";
import { isGitHubApiError } from "../../../integrations/github/errors";
import type { GitHubHttp } from "../../../integrations/github/http";
import type { RepoRef } from "../../workspace/repository";
import type { ActionsSource } from "../ports";
import type { Workflow, WorkflowRun } from "../workflow";

export function toWorkflow(w: GitHubWorkflow, repo: RepoRef): Workflow {
  return { id: w.id, repo, name: w.name, path: w.path, state: w.state, htmlUrl: w.html_url };
}

export function toRun(r: GitHubRun, repo: RepoRef): WorkflowRun {
  return {
    id: r.id,
    workflowId: r.workflow_id,
    repo,
    name: r.name,
    displayTitle: r.display_title,
    runNumber: r.run_number,
    status: r.status,
    conclusion: r.conclusion,
    event: r.event,
    headBranch: r.head_branch,
    actor: r.actor && { login: r.actor.login, avatarUrl: r.actor.avatar_url },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    htmlUrl: r.html_url,
  };
}

export function createGitHubActionsSource(httpFor: (repo: RepoRef) => GitHubHttp): ActionsSource {
  const call = (signal?: AbortSignal) => (signal ? { signal } : {});
  return {
    listWorkflows: async (repo, signal) => (await listWorkflows(httpFor(repo), repo, call(signal))).map((w) => toWorkflow(w, repo)),
    listRecentRuns: async (repo, signal) => (await listRecentRuns(httpFor(repo), repo, call(signal))).map((r) => toRun(r, repo)),
    readWorkflowFile: (repo, path, ref) => getFileText(httpFor(repo), repo, path, ref),
    listBranches: (repo) => listBranches(httpFor(repo), repo),
    listEnvironments: (repo) => listEnvironments(httpFor(repo), repo),
    async dispatch(repo, workflowId, ref, inputs) {
      const run = await dispatchWorkflow(httpFor(repo), repo, workflowId, ref, inputs);
      return run && { id: run.workflow_run_id, htmlUrl: run.html_url };
    },
    async readRun(repo, runId) {
      try {
        return toRun(await getRun(httpFor(repo), repo, runId), repo);
      } catch (e) {
        if (isGitHubApiError(e, "not_found")) return null;
        throw e;
      }
    },
    async searchRuns(repo, filter, maxResults, signal) {
      const res = await searchRuns(httpFor(repo), repo, filter, { maxResults, ...call(signal) });
      return { runs: res.runs.map((r) => toRun(r, repo)), truncated: res.truncated };
    },
    async removeRun(run, signal) {
      try {
        await deleteRun(httpFor(run.repo), run.repo, run.id, call(signal));
      } catch (e) {
        if (!isGitHubApiError(e, "not_found")) throw e;
      }
    },
  };
}

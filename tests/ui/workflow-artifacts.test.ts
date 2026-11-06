import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import type { WorkflowRun, WorkflowWithRun } from "../../src/features/actions/workflow";
import type { Artifact } from "../../src/features/artifacts/artifact";
import type { Repository } from "../../src/features/workspace/repository";
import type { UiDeps } from "../../src/ui/app/context";
import { createWorkflowArtifactsState } from "../../src/ui/screens/actions/artifacts-state";

const repo: Repository = {
  id: 1, owner: { login: "acme", id: 1, type: "Organization", avatarUrl: "" }, name: "web", fullName: "acme/web",
  private: true, archived: false, htmlUrl: "https://github.com/acme/web", pushedAt: null, defaultBranch: "master",
};
const ref = { owner: "acme", name: "web" };
const run = (id: number, workflowId: number, createdAt: string): WorkflowRun => ({
  id, workflowId, repo: ref, name: `wf${workflowId}`, displayTitle: null, runNumber: id, status: "completed", conclusion: "success",
  event: "push", headBranch: "main", actor: null, createdAt, updatedAt: createdAt, htmlUrl: "",
});
const artifact = (id: number, runId: number | null, name = `a${id}`): Artifact => ({
  id, repo: ref, name, sizeInBytes: 1, expired: false, createdAt: "2026-01-01T00:00:00Z", expiresAt: null, updatedAt: null, digest: null,
  workflowRun: runId === null ? null : { id: runId, headBranch: "main", headSha: null },
});
const wf = (id: number, name: string, runs: WorkflowRun[]): WorkflowWithRun => ({
  workflow: { id, repo: ref, name, path: `.github/workflows/${name}.yml`, state: "active", htmlUrl: "" },
  lastRun: runs[0] ?? null,
  recentRuns: runs,
});

function setup(readRun: (runId: number) => Promise<WorkflowRun | null>) {
  const calls: number[] = [];
  const deps = {
    manager: {
      now: () => 0,
      actions: { readRun: async (_r: unknown, id: number) => (calls.push(id), readRun(id)) },
      artifacts: { download: async () => 1, onDownloadInterrupted: () => () => undefined },
    },
  } as unknown as UiDeps;
  const [artifacts] = createSignal([{ repo, value: [artifact(1, 10), artifact(2, 11), artifact(3, 99), artifact(4, null)] }]);
  const [workflows] = createSignal([{ repo, value: [wf(5, "CI", [run(11, 5, "2026-01-02T00:00:00Z"), run(10, 5, "2026-01-01T00:00:00Z")]), wf(6, "Deploy", [])] }]);
  return { state: createRoot(() => createWorkflowArtifactsState(deps, { artifacts, workflows })), calls };
}

describe("Actions のアーティファクトのパネル", () => {
  it("最近の実行にある成果物は、呼び出しなしでワークフロー・実行ごとにまとめる", () => {
    const { state, calls } = setup(async () => null);
    const [g] = state.groups();
    expect(g!.workflows.map((w) => [w.name, w.runs.map((r) => [r.runId, r.artifacts.map((a) => a.id)])])).toEqual([
      ["CI", [[11, [2]], [10, [1]]]],
      [null, [[99, [3]], [null, [4]]]],
    ]);
    expect(calls).toEqual([]);
  });

  it("古い実行だけを 1 回ずつ読んでワークフローを調べ、同じ実行は 2 回読まない", async () => {
    const { state, calls } = setup(async (id) => (id === 99 ? run(99, 6, "2025-12-01T00:00:00Z") : null));
    expect(state.unknownRuns().map((u) => u.runId)).toEqual([99]);
    await state.resolveUnknownRuns();
    await state.resolveUnknownRuns();
    expect(calls).toEqual([99]);
    expect(state.groups()[0]!.workflows.map((w) => w.name)).toEqual(["CI", "Deploy", null]);
  });
});

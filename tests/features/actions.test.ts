import { describe, expect, it } from "vitest";
import { matchesWorkflow, runSearchFilter, summarizeRuns } from "../../src/features/actions/cleanup";
import { createActionsFeature } from "../../src/features/actions/compose";
import { DispatchInputError, toDispatchInputs, validateInputs } from "../../src/features/actions/controllers/dispatch";
import { defaultValues, parseDispatchSpec, WorkflowParseError } from "../../src/features/actions/dispatch";
import type { ActionsSource, DispatchTarget } from "../../src/features/actions/ports";
import { canTryDispatch, isFinished, latestRunByWorkflow, runBadge, withLatestRun, type Workflow, type WorkflowRun } from "../../src/features/actions/workflow";
import { createGitHubActionsSource } from "../../src/features/actions/gateways/github";
import { json, testHttp } from "../helpers";
import type { Repository } from "../../src/features/workspace/repository";
import { ValidationError } from "../../src/lib/validation";

const WORKFLOW_WITH_INPUTS = `
name: Deploy
on:
  push:
    branches: [master]
  workflow_dispatch:
    inputs:
      environment:
        description: Where to deploy
        type: environment
        required: true
      level:
        type: choice
        options: [info, debug, trace]
      dry_run:
        type: boolean
        default: true
      replicas:
        type: number
        default: 2
      note:
        description: Free text
jobs: {}
`;

describe("手動実行の入力定義", () => {
  it("入力の種類・必須・既定値・選択肢を読む", () => {
    expect(parseDispatchSpec(WORKFLOW_WITH_INPUTS)).toEqual({
      dispatchable: true,
      inputs: [
        { name: "environment", description: "Where to deploy", required: true, type: "environment", default: "", options: [] },
        { name: "level", description: null, required: false, type: "choice", default: "info", options: ["info", "debug", "trace"] },
        { name: "dry_run", description: null, required: false, type: "boolean", default: "true", options: [] },
        { name: "replicas", description: null, required: false, type: "number", default: "2", options: [] },
        { name: "note", description: "Free text", required: false, type: "string", default: "", options: [] },
      ],
    });
  });

  it.each([
    ["on: workflow_dispatch", true],
    ["on: [push, workflow_dispatch]", true],
    ["on:\n  workflow_dispatch:", true],
    ["on: push", false],
    ["on:\n  schedule:\n    - cron: '0 0 * * *'", false],
  ])("%j → dispatchable %s", (yaml, expected) => {
    expect(parseDispatchSpec(`${yaml}\njobs: {}`).dispatchable).toBe(expected);
  });

  it("壊れた YAML はエラー", () => {
    expect(() => parseDispatchSpec("on: [push\njobs:")).toThrow(WorkflowParseError);
    expect(() => parseDispatchSpec("- just\n- a list")).toThrow(WorkflowParseError);
  });
});

describe("手動実行の入力の検証（controller）", () => {
  const spec = parseDispatchSpec(WORKFLOW_WITH_INPUTS);
  if (!spec.dispatchable) throw new Error("unreachable");
  const inputs = spec.inputs;

  it("必須・数値・選択肢・Environment を検証する", () => {
    expect(defaultValues(inputs)).toEqual({ environment: "", level: "info", dry_run: "true", replicas: "2", note: "" });
    expect(validateInputs(inputs, { environment: "", level: "verbose", replicas: "two" }, ["prod"])).toEqual({
      environment: "required",
      level: "choice",
      replicas: "number",
    });
    expect(validateInputs(inputs, { environment: "staging", level: "info", replicas: "3" }, null)).toEqual({});
  });

  it("値は文字列で送り、必須でない空の値は送らない", () => {
    expect(toDispatchInputs(inputs, { environment: " prod ", level: "debug", dry_run: "false", replicas: "", note: "" })).toEqual({
      environment: "prod",
      level: "debug",
      dry_run: "false",
    });
  });
});

const repo: Repository = {
  id: 1, owner: { login: "acme", id: 1, type: "Organization", avatarUrl: "" }, name: "web", fullName: "acme/web", private: true, archived: false, htmlUrl: "", pushedAt: null, defaultBranch: "master",
};
const workflow = (id: number, name = `wf${id}`): Workflow => ({ id, repo: { owner: "acme", name: "web" }, name, path: `.github/workflows/${name}.yml`, state: "active", htmlUrl: "" });
const run = (id: number, workflowId: number, createdAt: string, o: Partial<WorkflowRun> = {}): WorkflowRun => ({
  id, workflowId, repo: { owner: "acme", name: "web" }, name: "CI", displayTitle: null, runNumber: id, status: "completed", conclusion: "success", event: "push", headBranch: "master", actor: null, createdAt, updatedAt: createdAt, htmlUrl: "", ...o,
});

function fakeSource(o: Partial<ActionsSource> = {}) {
  const calls: string[] = [];
  const dispatched: unknown[] = [];
  const source: ActionsSource = {
    listWorkflows: async (r) => (calls.push(`workflows ${r.name}`), r.name === "empty" ? [] : [workflow(10, "CI"), workflow(20, "Deploy")]),
    listRecentRuns: async (r) => (calls.push(`runs ${r.name}`), [run(3, 10, "2026-01-03"), run(2, 10, "2026-01-02"), run(1, 99, "2026-01-01")]),
    readWorkflowFile: async (_r, _p, ref) => (ref === "legacy" ? "on: push\njobs: {}" : WORKFLOW_WITH_INPUTS),
    listBranches: async () => ["dev", "master"],
    listEnvironments: async () => ["prod"],
    dispatch: async (r, id, ref, inputs) => (dispatched.push({ repo: r, id, ref, inputs }), { id: 500, htmlUrl: "https://github.com/acme/web/actions/runs/500" }),
    readRun: async () => null,
    searchRuns: async () => ({ runs: [], truncated: false }),
    removeRun: async () => undefined,
    ...o,
  };
  return { source, calls, dispatched };
}

describe("Actions の操作", () => {
  it("ワークフローに最新の実行を付け、ワークフローのないリポジトリでは実行履歴を取りにいかない", async () => {
    const { source, calls } = fakeSource();
    const f = createActionsFeature({ source, now: () => 0 });
    const [web, empty] = await f.list([repo, { ...repo, id: 2, name: "empty", fullName: "acme/empty" }]);
    expect(web!.ok && web!.value.map((w) => [w.workflow.name, w.lastRun?.id ?? null])).toEqual([["CI", 3], ["Deploy", null]]);
    expect(empty!.ok && empty!.value).toEqual([]);
    // 実行履歴の取得はレート制限を消費するので、不要なリクエストは送らない
    expect(calls).not.toContain("runs empty");
  });

  it("準備では既定のブランチの定義を読み、Environment が読めなくても続ける", async () => {
    const { source } = fakeSource({ listEnvironments: () => Promise.reject(new Error("forbidden")) });
    const p = await createActionsFeature({ source, now: () => 0 }).prepareDispatch({ repo, workflow: workflow(20, "Deploy") });
    expect(p.ref).toBe("master");
    expect(p.branches).toEqual(["dev", "master"]);
    expect(p.environments).toBeNull();
    expect(p.spec.dispatchable).toBe(true);
  });

  it("実行は入力を検証してから依頼し、誤りがあれば依頼しない", async () => {
    const { source, dispatched } = fakeSource();
    const f = createActionsFeature({ source, now: () => 0 });
    const target: DispatchTarget = { repo, workflow: workflow(20, "Deploy") };
    const spec = parseDispatchSpec(WORKFLOW_WITH_INPUTS);
    if (!spec.dispatchable) throw new Error("unreachable");
    const request = { target, ref: "master", inputs: spec.inputs, values: { ...defaultValues(spec.inputs) }, environments: ["prod"] };
    const err = await f.dispatch(request).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DispatchInputError);
    expect((err as DispatchInputError).errors).toEqual({ environment: "required" });
    await expect(f.dispatch({ ...request, ref: "" })).rejects.toBeInstanceOf(ValidationError);
    expect(dispatched).toEqual([]);
    expect(await f.dispatch({ ...request, values: { ...request.values, environment: "prod" } })).toEqual({ id: 500, htmlUrl: "https://github.com/acme/web/actions/runs/500" });
    expect(dispatched).toEqual([
      { repo: { owner: "acme", name: "web" }, id: 20, ref: "master", inputs: { environment: "prod", level: "info", dry_run: "true", replicas: "2" } },
    ]);
  });

  it("実行履歴の検索に、作成日と結果の条件を渡す", async () => {
    const filters: unknown[] = [];
    const { source } = fakeSource({ searchRuns: async (_r, filter) => (filters.push(filter), { runs: [], truncated: false }) });
    await createActionsFeature({ source, now: () => Date.parse("2026-11-01T12:00:00Z") }).searchRuns([repo], { olderThanDays: 30, conclusion: "failure", workflowQuery: "" });
    expect(filters).toEqual([{ created: "<2026-10-02", status: "failure" }]);
  });
});

describe("ワークフローと実行の判定", () => {
  it("有効で YAML のあるものだけ実行の候補にする", () => {
    expect(canTryDispatch({ path: ".github/workflows/ci.yml", state: "active" })).toBe(true);
    expect(canTryDispatch({ path: ".github/workflows/ci.yml", state: "disabled_manually" })).toBe(false);
    expect(canTryDispatch({ path: "dynamic/dependabot/dependabot-updates", state: "active" })).toBe(false);
  });

  it.each([
    [null, "none"],
    [{ status: "queued", conclusion: null }, "queued"],
    [{ status: "in_progress", conclusion: null }, "running"],
    [{ status: "completed", conclusion: "success" }, "success"],
    [{ status: "completed", conclusion: "timed_out" }, "failure"],
    [{ status: "completed", conclusion: "cancelled" }, "cancelled"],
    [{ status: "completed", conclusion: "action_required" }, "other"],
  ] as const)("%j → %s", (r, badge) => {
    expect(runBadge(r)).toBe(badge);
  });

  it("ワークフローごとに作成日時の最も新しい実行を選ぶ", () => {
    const latest = latestRunByWorkflow([run(1, 10, "2026-01-02"), run(2, 10, "2026-01-03"), run(3, 20, "2026-01-01")]);
    expect([...latest.entries()].map(([wf, r]) => [wf, r.id])).toEqual([[10, 2], [20, 3]]);
  });

  it("追っている実行は、そのワークフローの最新の実行と同じか新しいときだけ差し替える", () => {
    const list = [
      { workflow: workflow(10, "CI"), lastRun: run(5, 10, "2026-01-05T00:00:00Z"), recentRuns: [run(5, 10, "2026-01-05T00:00:00Z")] },
      { workflow: workflow(20, "Deploy"), lastRun: null, recentRuns: [] },
    ];
    const queued = run(6, 10, "2026-01-06T00:00:00Z", { status: "queued", conclusion: null });
    expect(withLatestRun(list, queued).map((w) => w.lastRun?.id ?? null)).toEqual([6, null]);
    // 古い実行では上書きしない
    expect(withLatestRun(list, run(4, 10, "2026-01-04T00:00:00Z"))[0]!.lastRun?.id).toBe(5);
    expect(withLatestRun(list, run(7, 20, "2026-01-01T00:00:00Z"))[1]!.lastRun?.id).toBe(7);
    expect(isFinished(queued)).toBe(false);
    expect(isFinished(run(5, 10, "2026-01-05"))).toBe(true);
  });

  it("作られた直後でまだ見えない実行（404）は null として返す", async () => {
    const { http } = testHttp(() => json({ message: "Not Found" }, { status: 404 }));
    const source = createGitHubActionsSource(() => http);
    expect(await source.readRun({ owner: "acme", name: "web" }, 321)).toBeNull();
  });

  it("整理の条件・ワークフロー名・まとめ", () => {
    expect(runSearchFilter({ olderThanDays: 30, conclusion: "all", workflowQuery: "" }, Date.parse("2026-11-01T12:00:00Z"))).toEqual({ created: "<2026-10-02", status: "completed" });
    expect(matchesWorkflow({ name: "Deploy prod" }, "deploy")).toBe(true);
    expect(matchesWorkflow({ name: null }, "")).toBe(true);
    expect(summarizeRuns([run(1, 1, "2026-09-01T00:00:00Z"), run(2, 1, "2026-08-01T00:00:00Z"), run(3, 2, "2026-09-15T00:00:00Z", { name: "Deploy" })])).toEqual({
      count: 3,
      byWorkflow: [{ name: "CI", count: 2 }, { name: "Deploy", count: 1 }],
      oldest: "2026-08-01T00:00:00Z",
      newest: "2026-09-15T00:00:00Z",
    });
  });
});

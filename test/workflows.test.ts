import { describe, expect, it } from "vitest";
import { latestRunByWorkflow, listWorkflowsForRepos } from "../src/api/aggregate";
import { decodeRepository } from "../src/api/decode";
import type { WorkflowRun } from "../src/api/types";
import {
  canTryDispatch,
  defaultValues,
  parseDispatchSpec,
  runBadge,
  toDispatchInputs,
  validateInputs,
  WorkflowParseError,
} from "../src/domain/workflows";
import { json, rawRepo, testClient } from "./helpers";

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
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`;

describe("parseDispatchSpec", () => {
  it("入力の種類・必須・既定値・選択肢を読む", () => {
    const spec = parseDispatchSpec(WORKFLOW_WITH_INPUTS);
    expect(spec).toEqual({
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
    ["on: [push, pull_request]", false],
    ["on:\n  schedule:\n    - cron: '0 0 * * *'", false],
  ])("%j → dispatchable %s", (yaml, expected) => {
    expect(parseDispatchSpec(`${yaml}\njobs: {}`).dispatchable).toBe(expected);
  });

  it("入力のない workflow_dispatch", () => {
    expect(parseDispatchSpec("on:\n  workflow_dispatch: {}\njobs: {}")).toEqual({ dispatchable: true, inputs: [] });
  });

  it("知らない type は string として扱う", () => {
    const spec = parseDispatchSpec("on:\n  workflow_dispatch:\n    inputs:\n      x:\n        type: future-type\n");
    expect(spec.dispatchable && spec.inputs[0]!.type).toBe("string");
  });

  it("壊れた YAML はエラー", () => {
    expect(() => parseDispatchSpec("on: [push\njobs:")).toThrow(WorkflowParseError);
    expect(() => parseDispatchSpec("- just\n- a list")).toThrow(WorkflowParseError);
  });
});

describe("入力値の検証と送る値", () => {
  const spec = parseDispatchSpec(WORKFLOW_WITH_INPUTS);
  if (!spec.dispatchable) throw new Error("unreachable");
  const inputs = spec.inputs;

  it("既定値から始める", () => {
    expect(defaultValues(inputs)).toEqual({ environment: "", level: "info", dry_run: "true", replicas: "2", note: "" });
  });

  it("必須・数値・選択肢・Environment を検証する", () => {
    expect(
      validateInputs(inputs, { environment: "", level: "verbose", dry_run: "true", replicas: "two", note: "" }, ["prod"]),
    ).toEqual({ environment: "required", level: "choice", replicas: "number" });
    expect(validateInputs(inputs, { environment: "staging", level: "info", replicas: "3" }, ["prod"])).toEqual({
      environment: "choice",
    });
    // Environment の一覧が取れないときは自由入力なので検証しない
    expect(validateInputs(inputs, { environment: "staging", level: "info", replicas: "3" }, null)).toEqual({});
  });

  it("値は文字列で送り、必須でない空の値は送らない", () => {
    expect(
      toDispatchInputs(inputs, { environment: " prod ", level: "debug", dry_run: "false", replicas: "", note: "" }),
    ).toEqual({ environment: "prod", level: "debug", dry_run: "false" });
  });
});

describe("ワークフローの表示用の判定", () => {
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
    [{ status: "completed", conclusion: "skipped" }, "skipped"],
    [{ status: "completed", conclusion: "action_required" }, "other"],
  ] as const)("%j → %s", (run, badge) => {
    expect(runBadge(run)).toBe(badge);
  });
});

const rawWorkflow = (id: number, name: string, path = `.github/workflows/${name}.yml`, state = "active") => ({
  id,
  node_id: `W_${id}`,
  name,
  path,
  state,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  url: "",
  html_url: `https://github.com/acme/web/actions/workflows/${name}.yml`,
  badge_url: "",
});

const rawRun = (id: number, workflowId: number, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  workflow_id: workflowId,
  run_number: id,
  status: "completed",
  conclusion: "success",
  event: "push",
  head_branch: "master",
  actor: { login: "alice", id: 1, type: "User", avatar_url: "a", html_url: "" },
  created_at: createdAt,
  updated_at: createdAt,
  html_url: `https://github.com/acme/web/actions/runs/${id}`,
  ...extra,
});

describe("latestRunByWorkflow", () => {
  it("ワークフローごとに作成日時の最も新しい実行を選ぶ", () => {
    const run = (id: number, wf: number, at: string) =>
      ({ id, workflowId: wf, createdAt: at }) as WorkflowRun;
    const latest = latestRunByWorkflow([run(1, 10, "2026-01-02"), run(2, 10, "2026-01-03"), run(3, 20, "2026-01-01")]);
    expect([...latest.entries()].map(([wf, r]) => [wf, r.id])).toEqual([
      [10, 2],
      [20, 3],
    ]);
  });
});

describe("GitHubClient のワークフロー関連", () => {
  it("dispatchWorkflow は ref と inputs を POST する", async () => {
    const { client, calls } = testClient(() => new Response(null, { status: 204 }));
    await client.dispatchWorkflow({ id: 7, repo: { owner: "acme", name: "web" } }, "master", { level: "debug" });
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url.pathname).toBe("/repos/acme/web/actions/workflows/7/dispatches");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ ref: "master", inputs: { level: "debug" } });
  });

  it("getFileText は raw で取得し、パスの各部分をエンコードする", async () => {
    const { client, calls } = testClient(() => new Response("on: push\n", { status: 200 }));
    expect(await client.getFileText({ owner: "acme", name: "web" }, ".github/workflows/a b.yml", "feat/x")).toBe("on: push\n");
    expect(calls[0]!.url.pathname).toBe("/repos/acme/web/contents/.github/workflows/a%20b.yml");
    expect(calls[0]!.url.searchParams.get("ref")).toBe("feat/x");
    expect(calls[0]!.headers.get("accept")).toBe("application/vnd.github.raw+json");
  });

  it("ブランチと Environment の名前を返す", async () => {
    const { client } = testClient((call) =>
      call.url.pathname.endsWith("/branches")
        ? json([{ name: "master", commit: {}, protected: true }, { name: "dev", commit: {}, protected: false }])
        : json({ total_count: 1, environments: [{ id: 1, name: "prod" }] }),
    );
    const repo = { owner: "acme", name: "web" };
    expect(await client.listBranches(repo)).toEqual(["master", "dev"]);
    expect(await client.listEnvironments(repo)).toEqual(["prod"]);
  });
});

describe("listWorkflowsForRepos", () => {
  const repo = (name: string, id: number) => decodeRepository(rawRepo("acme", name, "Organization", id));

  it("ワークフローに最新の実行を付け、ワークフローのないリポジトリでは実行履歴を取りにいかない", async () => {
    const { client, calls } = testClient((call) => {
      const p = call.url.pathname;
      if (p === "/repos/acme/web/actions/workflows")
        return json({ total_count: 2, workflows: [rawWorkflow(10, "ci"), rawWorkflow(20, "deploy")] });
      if (p === "/repos/acme/web/actions/runs")
        return json({
          total_count: 3,
          workflow_runs: [rawRun(3, 10, "2026-01-03T00:00:00Z"), rawRun(2, 10, "2026-01-02T00:00:00Z"), rawRun(1, 99, "2026-01-01T00:00:00Z")],
        });
      if (p === "/repos/acme/empty/actions/workflows") return json({ total_count: 0, workflows: [] });
      if (p === "/repos/acme/locked/actions/workflows") return json({ message: "Forbidden" }, { status: 403 });
      return json({ message: "unexpected" }, { status: 500 });
    });
    const results = await listWorkflowsForRepos(client, [repo("web", 1), repo("empty", 2), repo("locked", 3)]);
    const [web, empty, locked] = results;
    expect(web!.ok && web!.workflows.map((w) => [w.workflow.name, w.lastRun?.id ?? null])).toEqual([
      ["ci", 3],
      ["deploy", null],
    ]);
    expect(empty!.ok && empty!.workflows).toEqual([]);
    expect(!locked!.ok && locked!.error.kind).toBe("forbidden");
    expect(calls.some((c) => c.url.pathname === "/repos/acme/empty/actions/runs")).toBe(false);
  });
});

// ワークフローの手動実行の流れ: 定義の読み込み → 入力 → 確認 → 実行。
// 確認の画面を必ず挟み、入力の画面から直接は実行できないようにする。

import { createSignal } from "solid-js";
import type { GitHubClient } from "../../api/client";
import { GitHubApiError } from "../../api/errors";
import type { Repository, Workflow } from "../../api/types";
import {
  defaultValues,
  parseDispatchSpec,
  toDispatchInputs,
  validateInputs,
  WorkflowParseError,
  type DispatchInput,
  type InputError,
} from "../../domain/workflows";
import { toRepoRef } from "../../services/workspace";
import type { WorkspaceState } from "./workspace";

export interface DispatchTarget {
  repo: Repository;
  workflow: Workflow;
}

interface FormData {
  target: DispatchTarget;
  inputs: DispatchInput[];
  branches: string[];
  /** Environment の一覧。取得できなければ null（自由入力にする） */
  environments: string[] | null;
  ref: string;
  values: Record<string, string>;
}

export type DispatchPhase =
  | { phase: "closed" }
  | { phase: "loading"; target: DispatchTarget }
  | { phase: "unavailable"; target: DispatchTarget; reason: "not_dispatchable" | "parse"; detail: string | null }
  | { phase: "error"; target: DispatchTarget; error: GitHubApiError }
  | ({ phase: "form"; errors: Record<string, InputError>; reloading: boolean } & FormData)
  | ({ phase: "confirm"; payload: Record<string, string> } & FormData)
  | ({ phase: "running"; payload: Record<string, string> } & FormData)
  | { phase: "done"; target: DispatchTarget; ref: string }
  | ({ phase: "failed"; payload: Record<string, string>; error: GitHubApiError } & FormData);

/** 実行の依頼から一覧に新しい実行が現れるまでの目安 */
const REFRESH_DELAY_MS = 4000;

export function createDispatchState(ws: WorkspaceState, onDispatched: (repo: Repository) => void) {
  const [state, setState] = createSignal<DispatchPhase>({ phase: "closed" });
  // 閉じたあとに古い読み込みが結果を書き戻さないよう、開くたびに番号を変える
  let session = 0;

  const clientFor = (target: DispatchTarget): GitHubClient => {
    const router = ws.router();
    if (!router) throw new GitHubApiError({ kind: "unauthorized", message: "Not connected" });
    return router.forRepo(toRepoRef(target.repo));
  };

  const toApiError = (e: unknown) =>
    e instanceof GitHubApiError ? e : new GitHubApiError({ kind: "unexpected", message: String(e), cause: e });

  /** 指定したブランチの YAML から入力の定義を読む */
  async function readSpec(target: DispatchTarget, ref: string) {
    const text = await clientFor(target).getFileText(toRepoRef(target.repo), target.workflow.path, ref);
    return parseDispatchSpec(text);
  }

  function failSpec(target: DispatchTarget, id: number, e: unknown) {
    if (id !== session) return;
    if (e instanceof WorkflowParseError) setState({ phase: "unavailable", target, reason: "parse", detail: e.message });
    else setState({ phase: "error", target, error: toApiError(e) });
  }

  async function open(target: DispatchTarget) {
    const id = ++session;
    setState({ phase: "loading", target });
    try {
      const client = clientFor(target);
      const ref = toRepoRef(target.repo);
      const [branches, environments] = await Promise.all([
        client.listBranches(ref),
        client.listEnvironments(ref).catch(() => null),
      ]);
      const defaultRef = target.repo.defaultBranch ?? branches[0] ?? "";
      const spec = await readSpec(target, defaultRef);
      if (id !== session) return;
      if (!spec.dispatchable) {
        setState({ phase: "unavailable", target, reason: "not_dispatchable", detail: null });
        return;
      }
      setState({
        phase: "form",
        target,
        inputs: spec.inputs,
        branches: branches.includes(defaultRef) ? branches : [defaultRef, ...branches],
        environments,
        ref: defaultRef,
        values: defaultValues(spec.inputs),
        errors: {},
        reloading: false,
      });
    } catch (e) {
      failSpec(target, id, e);
    }
  }

  /** ブランチを変えたら、そのブランチの定義を読み直す（入力の定義はブランチごとに違いうる） */
  async function setRef(ref: string) {
    const s = state();
    if (s.phase !== "form") return;
    const id = session;
    setState({ ...s, ref, reloading: true });
    try {
      const spec = await readSpec(s.target, ref);
      const cur = state();
      if (id !== session || cur.phase !== "form") return;
      if (!spec.dispatchable) {
        setState({ phase: "unavailable", target: s.target, reason: "not_dispatchable", detail: ref });
        return;
      }
      // 同じ名前の入力は、入力済みの値を引き継ぐ
      const values = { ...defaultValues(spec.inputs) };
      for (const input of spec.inputs) if (input.name in cur.values) values[input.name] = cur.values[input.name]!;
      setState({ ...cur, inputs: spec.inputs, values, errors: {}, reloading: false });
    } catch (e) {
      failSpec(s.target, id, e);
    }
  }

  function setValue(name: string, value: string) {
    const s = state();
    if (s.phase !== "form") return;
    const { [name]: _removed, ...errors } = s.errors;
    setState({ ...s, values: { ...s.values, [name]: value }, errors });
  }

  /** 入力を検証し、問題がなければ確認の画面に進む */
  function review() {
    const s = state();
    if (s.phase !== "form" || s.reloading) return;
    const errors = validateInputs(s.inputs, s.values, s.environments);
    if (!s.ref || Object.keys(errors).length > 0) {
      setState({ ...s, errors });
      return;
    }
    const { errors: _e, reloading: _r, phase: _p, ...data } = s;
    setState({ ...data, phase: "confirm", payload: toDispatchInputs(s.inputs, s.values) });
  }

  function back() {
    const s = state();
    if (s.phase !== "confirm" && s.phase !== "failed") return;
    const { payload: _p, phase: _ph, ...data } = s as Extract<DispatchPhase, { phase: "confirm" }>;
    setState({ ...data, phase: "form", errors: {}, reloading: false });
  }

  /** 確認の画面からだけ実行できる */
  async function run() {
    const s = state();
    if (s.phase !== "confirm") return;
    const id = session;
    setState({ ...s, phase: "running" });
    try {
      await clientFor(s.target).dispatchWorkflow(s.target.workflow, s.ref, s.payload);
      if (id !== session) return;
      setState({ phase: "done", target: s.target, ref: s.ref });
      setTimeout(() => onDispatched(s.target.repo), REFRESH_DELAY_MS);
    } catch (e) {
      if (id !== session) return;
      setState({ ...s, phase: "failed", error: toApiError(e) });
    }
  }

  function close() {
    if (state().phase === "running") return;
    session++;
    setState({ phase: "closed" });
  }

  return { state, open, setRef, setValue, review, back, run, close };
}

export type DispatchState = ReturnType<typeof createDispatchState>;

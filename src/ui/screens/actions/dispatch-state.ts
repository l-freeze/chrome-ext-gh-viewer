// ワークフローの手動実行の流れ: 定義の読み込み → 入力 → 確認 → 実行。
// 確認の画面を必ず挟み、入力の画面から直接は実行できないようにする。

import { createSignal } from "solid-js";
import { defaultValues, WorkflowParseError, type DispatchInput } from "../../../features/actions/dispatch";
import type { DispatchedRun, DispatchInputError, DispatchTarget } from "../../../features/actions/ports";
import type { Repository } from "../../../features/workspace/repository";
import type { UiDeps } from "../../app/context";

export type { DispatchTarget };

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
  | { phase: "error"; target: DispatchTarget; error: unknown }
  | ({ phase: "form"; errors: Record<string, DispatchInputError>; reloading: boolean } & FormData)
  | ({ phase: "confirm"; payload: Record<string, string> } & FormData)
  | ({ phase: "running"; payload: Record<string, string> } & FormData)
  | { phase: "done"; target: DispatchTarget; ref: string; runUrl: string | null }
  | ({ phase: "failed"; payload: Record<string, string>; error: unknown } & FormData);

/** onDispatched: 実行を依頼できたとき。GitHub が作られた実行を返さなかったときは run が null */
export function createDispatchState(deps: UiDeps, onDispatched: (repo: Repository, run: DispatchedRun | null) => void) {
  const ops = deps.manager.actions;
  const [state, setState] = createSignal<DispatchPhase>({ phase: "closed" });
  // 閉じたあとに古い読み込みが結果を書き戻さないよう、開くたびに番号を変える
  let session = 0;

  function failSpec(target: DispatchTarget, id: number, error: unknown) {
    if (id !== session) return;
    if (error instanceof WorkflowParseError) setState({ phase: "unavailable", target, reason: "parse", detail: error.message });
    else setState({ phase: "error", target, error });
  }

  const request = (s: FormData) => ({ target: s.target, ref: s.ref, inputs: s.inputs, values: s.values, environments: s.environments });

  async function open(target: DispatchTarget) {
    const id = ++session;
    setState({ phase: "loading", target });
    try {
      const p = await ops.prepareDispatch(target);
      if (id !== session) return;
      if (!p.spec.dispatchable) {
        setState({ phase: "unavailable", target, reason: "not_dispatchable", detail: null });
        return;
      }
      setState({
        phase: "form",
        target,
        inputs: p.spec.inputs,
        branches: p.branches,
        environments: p.environments,
        ref: p.ref,
        values: defaultValues(p.spec.inputs),
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
      const spec = await ops.readDispatchSpec(s.target, ref);
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
    const result = ops.reviewDispatch(request(s));
    if (!result.ok) {
      setState({ ...s, errors: result.errors });
      return;
    }
    const { errors: _e, reloading: _r, phase: _p, ...data } = s;
    setState({ ...data, phase: "confirm", payload: result.inputs });
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
      const run = await ops.dispatch(request(s));
      onDispatched(s.target.repo, run);
      if (id !== session) return;
      setState({ phase: "done", target: s.target, ref: s.ref, runUrl: run?.htmlUrl ?? null });
    } catch (error) {
      if (id !== session) return;
      setState({ ...s, phase: "failed", error });
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

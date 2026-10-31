// ワークフローの手動実行（workflow_dispatch）に関わる純粋な処理:
// YAML から入力の定義を読む、入力値を検証する、送る値を組み立てる。

import { parse } from "yaml";
import type { Workflow, WorkflowRun } from "../api/types";

export type DispatchInputType = "string" | "boolean" | "choice" | "number" | "environment";

export interface DispatchInput {
  name: string;
  description: string | null;
  required: boolean;
  type: DispatchInputType;
  /** 画面に最初に入れておく値（文字列。boolean は "true" / "false"） */
  default: string;
  /** choice の選択肢 */
  options: string[];
}

export type DispatchSpec = { dispatchable: false } | { dispatchable: true; inputs: DispatchInput[] };

export class WorkflowParseError extends Error {
  override readonly name = "WorkflowParseError";
}

const INPUT_TYPES: readonly DispatchInputType[] = ["string", "boolean", "choice", "number", "environment"];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** ワークフローの YAML から、手動実行できるかと入力の定義を読む */
export function parseDispatchSpec(yamlText: string): DispatchSpec {
  let doc: unknown;
  try {
    doc = parse(yamlText);
  } catch (e) {
    throw new WorkflowParseError(e instanceof Error ? e.message : String(e));
  }
  if (!isObj(doc)) throw new WorkflowParseError("The workflow file is not a mapping");

  // YAML 1.1 の読み方では on が true になるので、その形も受け付ける
  const on = "on" in doc ? doc["on"] : doc["true"];
  if (typeof on === "string") return on === "workflow_dispatch" ? { dispatchable: true, inputs: [] } : { dispatchable: false };
  if (Array.isArray(on)) return on.includes("workflow_dispatch") ? { dispatchable: true, inputs: [] } : { dispatchable: false };
  if (!isObj(on) || !("workflow_dispatch" in on)) return { dispatchable: false };

  const config = on["workflow_dispatch"];
  const rawInputs = isObj(config) && isObj(config["inputs"]) ? config["inputs"] : {};
  const inputs = Object.entries(rawInputs).map(([name, def]): DispatchInput => {
    const d = isObj(def) ? def : {};
    const typeValue = typeof d["type"] === "string" ? d["type"] : "string";
    const type = (INPUT_TYPES as readonly string[]).includes(typeValue) ? (typeValue as DispatchInputType) : "string";
    const options = Array.isArray(d["options"]) ? d["options"].map((x) => String(x)) : [];
    const rawDefault = d["default"];
    let defaultValue =
      rawDefault === undefined || rawDefault === null ? "" : typeof rawDefault === "string" ? rawDefault : String(rawDefault);
    if (type === "boolean") defaultValue = defaultValue === "true" ? "true" : "false";
    // GitHub の画面と同じく、choice は既定値がなければ最初の選択肢を選んでおく
    if (type === "choice" && defaultValue === "") defaultValue = options[0] ?? "";
    return {
      name,
      description: typeof d["description"] === "string" ? d["description"] : null,
      required: d["required"] === true,
      type,
      default: defaultValue,
      options,
    };
  });
  return { dispatchable: true, inputs };
}

export function defaultValues(inputs: readonly DispatchInput[]): Record<string, string> {
  return Object.fromEntries(inputs.map((i) => [i.name, i.default]));
}

export type InputError = "required" | "number" | "choice";

/** 入力値の誤りを入力名ごとに返す。誤りがなければ空のオブジェクト */
export function validateInputs(
  inputs: readonly DispatchInput[],
  values: Readonly<Record<string, string>>,
  environments: readonly string[] | null = null,
): Record<string, InputError> {
  const errors: Record<string, InputError> = {};
  for (const input of inputs) {
    const value = (values[input.name] ?? "").trim();
    if (input.type === "boolean") continue;
    if (value === "") {
      if (input.required) errors[input.name] = "required";
      continue;
    }
    if (input.type === "number" && !Number.isFinite(Number(value))) errors[input.name] = "number";
    if (input.type === "choice" && !input.options.includes(value)) errors[input.name] = "choice";
    if (input.type === "environment" && environments !== null && !environments.includes(value)) errors[input.name] = "choice";
  }
  return errors;
}

/**
 * API に送る inputs。値はすべて文字列で送る（GitHub の画面と同じ）。
 * 必須でない空の値は送らず、ワークフロー側の既定値に任せる。
 */
export function toDispatchInputs(
  inputs: readonly DispatchInput[],
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const input of inputs) {
    const value = input.type === "boolean" ? (values[input.name] === "true" ? "true" : "false") : (values[input.name] ?? "").trim();
    if (value === "" && !input.required) continue;
    result[input.name] = value;
  }
  return result;
}

/** GitHub が内部で動かすワークフロー（Dependabot、CodeQL の既定設定など）。手動実行できない */
export function isDynamicWorkflow(w: Pick<Workflow, "path">): boolean {
  return w.path.startsWith("dynamic/");
}

/** 手動実行の候補にできるか（有効で、YAML ファイルのあるワークフロー） */
export function canTryDispatch(w: Pick<Workflow, "path" | "state">): boolean {
  return w.state === "active" && !isDynamicWorkflow(w);
}

export type RunBadge = "success" | "failure" | "cancelled" | "running" | "queued" | "skipped" | "other" | "none";

/** 実行の状態を表示用の分類にする */
export function runBadge(run: Pick<WorkflowRun, "status" | "conclusion"> | null): RunBadge {
  if (!run) return "none";
  if (run.status === "queued" || run.status === "waiting" || run.status === "pending" || run.status === "requested") return "queued";
  if (run.status !== "completed") return "running";
  switch (run.conclusion) {
    case "success":
      return "success";
    case "failure":
    case "timed_out":
    case "startup_failure":
      return "failure";
    case "cancelled":
      return "cancelled";
    case "skipped":
    case "neutral":
      return "skipped";
    default:
      return "other";
  }
}

// ワークフローの手動実行（workflow_dispatch）の入力定義: YAML から読み、画面に最初に入れる値を決める。

import { parse } from "yaml";

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

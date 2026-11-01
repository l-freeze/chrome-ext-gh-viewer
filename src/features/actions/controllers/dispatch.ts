// 手動実行の入力の検証。画面で人が入力した値をここで確かめてから実行する。

import { ValidationError, type Validator } from "../../../lib/validation";
import type { DispatchInput } from "../dispatch";
import type { DispatchWorkflow, DispatchWorkflowInput } from "../use-cases/dispatch";
import type { DispatchRequest } from "../ports";

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

/** 入力に誤りがある。errors は入力名ごとの誤り */
export class DispatchInputError extends ValidationError {
  constructor(readonly errors: Record<string, InputError>) {
    super("Some inputs are invalid.");
  }
}

const input: Validator<DispatchWorkflowInput> = {
  parse(raw) {
    const r = raw as DispatchRequest;
    if (!r || typeof r !== "object" || !r.target || typeof r.ref !== "string" || r.ref === "") {
      throw new ValidationError("Choose a branch to run the workflow on.");
    }
    const errors = validateInputs(r.inputs, r.values, r.environments);
    if (Object.keys(errors).length > 0) throw new DispatchInputError(errors);
    return { target: r.target, ref: r.ref, inputs: toDispatchInputs(r.inputs, r.values) };
  },
};

export function createDispatchController(execute: DispatchWorkflow) {
  return async (raw: unknown) => execute(input.parse(raw));
}



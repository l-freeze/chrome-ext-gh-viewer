import { toRepoRef } from "../../workspace/repository";
import type { ActionsSource, DispatchedRun, DispatchTarget } from "../ports";

export interface DispatchWorkflowInput {
  target: DispatchTarget;
  ref: string;
  /** 送る入力値（検証済み・文字列） */
  inputs: Record<string, string>;
}

export type DispatchWorkflow = (input: DispatchWorkflowInput) => Promise<DispatchedRun | null>;

export function createDispatchWorkflow(source: ActionsSource): DispatchWorkflow {
  return ({ target, ref, inputs }) => source.dispatch(toRepoRef(target.repo), target.workflow.id, ref, inputs);
}

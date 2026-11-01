import { toRepoRef } from "../../workspace/repository";
import { parseDispatchSpec } from "../dispatch";
import type { ActionsOperations, ActionsSource } from "../ports";

export function createReadDispatchSpec(source: ActionsSource): ActionsOperations["readDispatchSpec"] {
  return async (target, ref) => parseDispatchSpec(await source.readWorkflowFile(toRepoRef(target.repo), target.workflow.path, ref));
}

/** ブランチと Environment を読み → 既定のブランチを決め → そのブランチの定義を読む */
export function createPrepareDispatch(source: ActionsSource): ActionsOperations["prepareDispatch"] {
  const readSpec = createReadDispatchSpec(source);
  return async (target) => {
    const ref = toRepoRef(target.repo);
    const [branches, environments] = await Promise.all([
      source.listBranches(ref),
      // 読めなくても実行はできる（Environment の入力は自由入力にする）
      source.listEnvironments(ref).catch(() => null),
    ]);
    const defaultRef = target.repo.defaultBranch ?? branches[0] ?? "";
    const spec = await readSpec(target, defaultRef);
    return { spec, branches: branches.includes(defaultRef) ? branches : [defaultRef, ...branches], environments, ref: defaultRef };
  };
}

import { canMoveToAnotherProject, projectKey } from "../project";
import type { ProjectOperations, ProjectSource } from "../ports";
import { InvalidMoveError } from "./move-item";

/**
 * 別のプロジェクトへ移す: 移す先に加える → 列（Status）を付ける → 元から外す。
 * 列を付けるところで失敗したら、新しく加えた分は外して、元のプロジェクトに残したままにする
 */
export function createMoveToProject(source: ProjectSource): ProjectOperations["moveToProject"] {
  return async (from, itemId, to, statusId) => {
    const item = from.items.find((i) => i.id === itemId);
    if (!item) throw new InvalidMoveError(`Item ${itemId} is not in this project`);
    if (projectKey(from.project) === projectKey(to.project)) throw new InvalidMoveError("The item is already in this project");
    if (!canMoveToAnotherProject(item)) throw new InvalidMoveError("Only issues and pull requests can move to another project");
    if (statusId !== null && !to.field?.options.some((o) => o.id === statusId)) {
      throw new InvalidMoveError(`Option ${statusId} is not in the target project`);
    }
    // すでに移す先に入っていれば、その項目を使う（外すのは元の分だけ）
    const existing = to.items.find((i) => i.kind === item.kind && i.repo?.owner === item.repo?.owner && i.repo?.name === item.repo?.name && i.number === item.number);
    const newId = existing?.id ?? (await source.addItem(to.project, item));
    if (to.field && statusId !== (existing?.statusId ?? null)) {
      try {
        await source.setItemField(to.project, newId, to.field.id, statusId);
      } catch (error) {
        if (!existing) await source.removeItem(to.project, newId).catch(() => undefined);
        throw error;
      }
    }
    await source.removeItem(from.project, itemId);
    return { ...(existing ?? item), id: newId, statusId };
  };
}

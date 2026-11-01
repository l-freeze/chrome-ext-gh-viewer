import type { ProjectOperations, ProjectSource } from "../ports";

export class InvalidMoveError extends Error {
  override readonly name = "InvalidMoveError";
}

export function createMoveItem(source: ProjectSource): ProjectOperations["moveItem"] {
  return async (board, itemId, statusId) => {
    const field = board.field;
    if (!field) throw new InvalidMoveError("This project has no single select field");
    if (!board.items.some((i) => i.id === itemId)) throw new InvalidMoveError(`Item ${itemId} is not in this project`);
    if (statusId !== null && !field.options.some((o) => o.id === statusId)) {
      throw new InvalidMoveError(`Option ${statusId} is not in ${field.name}`);
    }
    await source.setItemField(board.project, itemId, field.id, statusId);
  };
}

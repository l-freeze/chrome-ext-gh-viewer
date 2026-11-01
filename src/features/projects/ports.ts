import type { Owner } from "../workspace/repository";
import type { Board } from "./board";
import type { ItemKind, Project, ProjectItem, SelectField } from "./project";

export interface OwnerProjects {
  owner: Owner;
  /** 開いているプロジェクト（タイトル順） */
  projects: Project[];
  error: unknown | null;
}

/** カンバンの表示の好み。端末に保存する */
export interface BoardPreferences {
  /** 表示する項目の種類 */
  kinds: ItemKind[];
  /** 折りたたんだプロジェクト（projectKey） */
  collapsed: string[];
}

export const DEFAULT_BOARD_PREFERENCES: BoardPreferences = { kinds: ["issue", "draft"], collapsed: [] };

/** 画面から呼ぶ操作 */
export interface ProjectOperations {
  /** 所有者ごとのプロジェクト。1 つの所有者の失敗では止めない */
  listProjects(
    owners: readonly Owner[],
    options?: { signal?: AbortSignal; onOwnerDone?: (result: OwnerProjects) => void },
  ): Promise<OwnerProjects[]>;
  /** 列にするフィールドと、全種類の項目（アーカイブ済みを除く）。種類の切り替えは取得し直さずに済む */
  loadBoard(project: Project, signal?: AbortSignal): Promise<Board>;
  /** 項目を別の列へ動かす。statusId が null なら未設定にする */
  moveItem(board: Board, itemId: number, statusId: string | null): Promise<void>;
  loadPreferences(): Promise<BoardPreferences>;
  savePreferences(preferences: BoardPreferences): Promise<void>;
}

export interface ProjectSource {
  listProjects(owner: Owner, signal?: AbortSignal): Promise<Project[]>;
  /** 単一選択のフィールド */
  listSelectFields(project: Project, signal?: AbortSignal): Promise<SelectField[]>;
  /** fieldId のフィールドの値も一緒に取得する */
  listItems(project: Project, fieldId: number | null, signal?: AbortSignal): Promise<ProjectItem[]>;
  setItemField(project: Project, itemId: number, fieldId: number, optionId: string | null): Promise<void>;
}

export interface BoardPreferencesRepository {
  load(): Promise<BoardPreferences>;
  save(preferences: BoardPreferences): Promise<void>;
}

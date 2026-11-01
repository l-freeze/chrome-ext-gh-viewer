/** 画面をまたぐ表示の好み。端末に保存する */
export interface DisplayPreferences {
  /** 開いている画面の情報を一定の間隔で取り直す */
  autoRefresh: boolean;
}

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = { autoRefresh: true };

/** 画面から呼ぶ操作 */
export interface PreferenceOperations {
  load(): Promise<DisplayPreferences>;
  save(preferences: DisplayPreferences): Promise<void>;
}

export interface DisplayPreferencesRepository {
  load(): Promise<DisplayPreferences>;
  save(preferences: DisplayPreferences): Promise<void>;
}

import type { Settled, SettleOptions } from "../../lib/concurrency";
import type { RepoRef, Repository } from "../workspace/repository";
import type { Label, LabelValue } from "./label";
import type { LabelChange } from "./sync";

/** 画面から呼ぶ操作 */
export interface LabelOperations {
  /** リポジトリごとのラベル。アーカイブ済みのリポジトリは変えられないので、呼ばずに空とする */
  list(repos: readonly Repository[], options?: SettleOptions<Repository, Label[]>): Promise<Settled<Repository, Label[]>[]>;
  /** 変更を 1 件ずつ順に送る（GitHub の書き込みの制限に触れないよう同時には送らない）。1 件の失敗では止めない */
  apply(changes: readonly LabelChange[], options?: SettleOptions<LabelChange, Label>): Promise<Settled<LabelChange, Label>[]>;
  /**
   * ラベルを 1 件ずつ順に削除する。付いている Issue と PR からも外れ、元に戻せない。
   * 確認（画面の 2 段階の確認）を経てから呼ぶ。すでに消えているものは成功とみなす
   */
  remove(labels: readonly Label[], options?: SettleOptions<Label, void>): Promise<Settled<Label, void>[]>;
}

export interface LabelSource {
  list(repo: RepoRef, signal?: AbortSignal): Promise<Label[]>;
  create(repo: RepoRef, value: LabelValue, signal?: AbortSignal): Promise<Label>;
  /** currentName のラベルを value にする（名前も変えられる） */
  update(repo: RepoRef, currentName: string, value: LabelValue, signal?: AbortSignal): Promise<Label>;
  remove(repo: RepoRef, name: string, signal?: AbortSignal): Promise<void>;
}

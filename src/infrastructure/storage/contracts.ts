// 保存先の driver の約束と、型付きの保存・読み込み。
// driver は値の中身を知らない。保存形式と検証は使う側（各機能の gateway）が持つ。

import type { Validator } from "../../lib/validation";

export interface StorageDriver {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface StorageContract<Save, Load> {
  key: string;
  /** 保存する値の検証 */
  input: Validator<Save>;
  /** 読み出した値の検証。保存前にも、読み出せる値かを確かめるために使う */
  output: Validator<Load>;
  /** まだ保存されていないときの値 */
  empty: () => Load;
  encode: (value: Save) => unknown;
}

export interface TypedStore<Save, Load> {
  load(): Promise<Load>;
  save(value: Save): Promise<void>;
}

export function typedStore<Save, Load>(driver: StorageDriver, contract: StorageContract<Save, Load>): TypedStore<Save, Load> {
  return {
    async load() {
      const raw = await driver.get(contract.key);
      return raw === undefined ? contract.empty() : contract.output.parse(raw);
    },
    async save(value) {
      const encoded = contract.encode(contract.input.parse(value));
      contract.output.parse(encoded);
      await driver.set(contract.key, encoded);
    },
  };
}

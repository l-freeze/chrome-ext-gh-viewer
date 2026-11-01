// 検証の仕組みだけを置く。どの項目が必須か、どんな条件か、は各境界が持つ。

export interface Validator<Output> {
  parse(input: unknown): Output;
}

/** 値の形が想定と違う。path はどこが違ったかを示す（例: artifacts[0].id） */
export class ValidationError extends Error {
  override readonly name = "ValidationError";
  constructor(
    message: string,
    readonly path: string | null = null,
  ) {
    super(message);
  }
}

/** 検証してから実行する。検証を省けないようにするための包み */
export function validatedAction<Input, Output>(
  validator: Validator<Input>,
  execute: (input: Input) => Promise<Output>,
): (raw: unknown) => Promise<Output> {
  return async (raw) => execute(validator.parse(raw));
}

// ---- 値の形を読む道具 -----------------------------------------------------

export type Obj = Record<string, unknown>;

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function mismatch(path: string, expected: string, actual: unknown): ValidationError {
  return new ValidationError(`${path}: expected ${expected}, got ${describe(actual)}`, path);
}

export function obj(v: unknown, path: string): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw mismatch(path, "object", v);
  return v as Obj;
}

export function arrayOf<T>(v: unknown, path: string, item: (v: unknown, path: string) => T): T[] {
  if (!Array.isArray(v)) throw mismatch(path, "array", v);
  return v.map((x, i) => item(x, `${path}[${i}]`));
}

export function str(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== "string") throw mismatch(`${path}.${key}`, "string", v);
  return v;
}

export function num(o: Obj, key: string, path: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v)) throw mismatch(`${path}.${key}`, "number", v);
  return v;
}

export function bool(o: Obj, key: string, path: string): boolean {
  const v = o[key];
  if (typeof v !== "boolean") throw mismatch(`${path}.${key}`, "boolean", v);
  return v;
}

/** null / undefined を許す文字列 */
export function optStr(o: Obj, key: string, path: string): string | null {
  const v = o[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw mismatch(`${path}.${key}`, "string | null", v);
  return v;
}

export function optNum(o: Obj, key: string, path: string): number | null {
  const v = o[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) throw mismatch(`${path}.${key}`, "number | null", v);
  return v;
}

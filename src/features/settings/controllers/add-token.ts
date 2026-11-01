import { validatedAction, ValidationError, type Validator } from "../../../lib/validation";
import type { AddToken, AddTokenInput } from "../use-cases/add-token";

/** 貼り付けられた文字列の前後の空白を除き、空や途中に空白を含むものは受け付けない */
const input: Validator<AddTokenInput> = {
  parse(raw) {
    const token = typeof raw === "string" ? raw.trim() : "";
    if (token === "" || /\s/.test(token)) throw new ValidationError("Enter a single token.");
    return { token };
  },
};

export function createAddTokenController(execute: AddToken) {
  return validatedAction(input, execute);
}

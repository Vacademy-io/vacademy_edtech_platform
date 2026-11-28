import { describe, expect, it } from "vitest";
import {
  KEYPAD_MAX_LENGTH,
  applyKeypadKey,
  isValidTypedNumber,
  type KeypadKey,
} from "./keypad-logic";

const type = (keys: KeypadKey[], start = { value: "", caret: 0 }) =>
  keys.reduce((state, key) => applyKeypadKey(state, key), start);

describe("console keypad", () => {
  it("types digits and one decimal point", () => {
    expect(type(["1", ".", "5", ".", "2"]).value).toBe("1.52");
  });

  it("allows a minus only as the first character", () => {
    expect(type(["-", "3"]).value).toBe("-3");
    expect(type(["3", "-"]).value).toBe("3");
    expect(type(["-", "-", "3"]).value).toBe("-3");
  });

  it("types nothing in front of a leading minus", () => {
    const state = type(["-", "4", "left", "left"]);
    expect(state.caret).toBe(0);
    expect(applyKeypadKey(state, "7").value).toBe("-4");
  });

  it("moves the caret and inserts there", () => {
    expect(type(["1", "2", "left", "9"]).value).toBe("192");
    expect(type(["1", "left", "left", "right", "right", "5"]).value).toBe("15");
  });

  it("Backspace deletes before the caret; Clear All empties", () => {
    expect(type(["1", "2", "3", "left", "backspace"]).value).toBe("13");
    expect(type(["1", "2", "clear"])).toEqual({ value: "", caret: 0 });
    expect(type(["backspace"]).value).toBe("");
  });

  it("stops at the length limit", () => {
    const keys = Array.from({ length: KEYPAD_MAX_LENGTH + 3 }, () => "9" as KeypadKey);
    expect(type(keys).value).toHaveLength(KEYPAD_MAX_LENGTH);
  });

  it("checks typed input (practice-friendly)", () => {
    expect(isValidTypedNumber("-12.5")).toBe(true);
    expect(isValidTypedNumber("")).toBe(true);
    expect(isValidTypedNumber("1-2")).toBe(false);
    expect(isValidTypedNumber("1.2.3")).toBe(false);
    expect(isValidTypedNumber("abc")).toBe(false);
  });
});

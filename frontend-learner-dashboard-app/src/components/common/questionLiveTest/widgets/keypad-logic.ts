/**
 * Console numeric keypad rules: at most 15 characters, a minus only as the
 * first character, at most one decimal point, and a caret moved with the
 * arrow keys. Pure, so the keypad component and tests share it.
 */
export const KEYPAD_MAX_LENGTH = 15;

export type KeypadKey =
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
  | "."
  | "-"
  | "backspace"
  | "clear"
  | "left"
  | "right";

export interface KeypadState {
  value: string;
  /** Insertion point, 0..value.length. */
  caret: number;
}

const insert = (state: KeypadState, text: string): KeypadState => ({
  value: state.value.slice(0, state.caret) + text + state.value.slice(state.caret),
  caret: state.caret + text.length,
});

export function applyKeypadKey(input: KeypadState, key: KeypadKey): KeypadState {
  const caret = Math.min(Math.max(0, input.caret), input.value.length);
  const state = { value: input.value, caret };
  const full = state.value.length >= KEYPAD_MAX_LENGTH;
  // Nothing may be typed in front of a leading minus.
  const beforeMinus = state.value.startsWith("-") && caret === 0;

  switch (key) {
    case "backspace":
      if (caret === 0) return state;
      return {
        value: state.value.slice(0, caret - 1) + state.value.slice(caret),
        caret: caret - 1,
      };
    case "clear":
      return { value: "", caret: 0 };
    case "left":
      return { ...state, caret: Math.max(0, caret - 1) };
    case "right":
      return { ...state, caret: Math.min(state.value.length, caret + 1) };
    case "-":
      if (full || caret !== 0 || state.value.startsWith("-")) return state;
      return insert(state, "-");
    case ".":
      if (full || beforeMinus || state.value.includes(".")) return state;
      return insert(state, ".");
    default:
      if (full || beforeMinus) return state;
      return insert(state, key);
  }
}

/** Typed input accepted when the physical keyboard is allowed (practice-friendly). */
export const isValidTypedNumber = (value: string): boolean =>
  value.length <= KEYPAD_MAX_LENGTH && /^-?\d*\.?\d*$/.test(value);

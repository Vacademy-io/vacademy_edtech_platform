/**
 * Expression engine for the in-exam calculator.
 *
 * Deliberately a hand-written tokenizer + recursive-descent parser rather than
 * `new Function(...)`: the app ships inside a Capacitor WebView whose CSP
 * forbids eval, and an exam surface is the last place to relax that.
 *
 * The grammar matches what the keypad can produce:
 *
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/') unary)*
 *   unary   := '-' unary | power
 *   power   := postfix ('^' unary)?          // right-associative
 *   postfix := primary ('!' | '^2' | '^3' | '%')*
 *   primary := number | constant | func '(' expr ')' | '(' expr ')'
 */

import i18n from "@/i18n";

export type AngleUnit = "DEG" | "RAD";

/** Display glyphs the keypad inserts, mapped to the tokens the parser reads. */
const GLYPH_TO_TOKEN: Array<[RegExp, string]> = [
  [/×/g, "*"],
  [/÷/g, "/"],
  [/−/g, "-"],
  [/–/g, "-"],
  [/π/g, "PI"],
  [/√/g, "sqrt"],
  [/∛/g, "cbrt"],
  [/²/g, "^2"],
  [/³/g, "^3"],
];

const FUNCTIONS = [
  "asin",
  "acos",
  "atan",
  "sinh",
  "cosh",
  "tanh",
  "sin",
  "cos",
  "tan",
  "sqrt",
  "cbrt",
  "log",
  "ln",
  "exp",
  "abs",
] as const;

type FunctionName = (typeof FUNCTIONS)[number];

type Token =
  | { kind: "number"; value: number }
  | { kind: "const"; name: "PI" | "E" }
  | { kind: "func"; name: FunctionName }
  | { kind: "op"; value: string };

export class CalculatorError extends Error {}

const DEG_PER_RAD = 180 / Math.PI;

function toRadians(value: number, unit: AngleUnit): number {
  return unit === "DEG" ? value / DEG_PER_RAD : value;
}

function fromRadians(value: number, unit: AngleUnit): number {
  return unit === "DEG" ? value * DEG_PER_RAD : value;
}

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new CalculatorError(
      i18n.t("questionTest:calculator.errors.factorialWholeNumber"),
    );
  }
  if (n > 170)
    throw new CalculatorError(i18n.t("questionTest:calculator.errors.tooLarge"));
  let result = 1;
  for (let i = 2; i <= n; i += 1) result *= i;
  return result;
}

function tokenize(input: string): Token[] {
  let normalized = input;
  GLYPH_TO_TOKEN.forEach(([pattern, replacement]) => {
    normalized = normalized.replace(pattern, replacement);
  });

  const tokens: Token[] = [];
  let i = 0;

  while (i < normalized.length) {
    const char = normalized[i];

    if (char === " ") {
      i += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      let literal = "";
      while (i < normalized.length && /[0-9.]/.test(normalized[i])) {
        literal += normalized[i];
        i += 1;
      }
      // Scientific notation entered via the EXP key: 1.2e-5
      if (
        (normalized[i] === "e" || normalized[i] === "E") &&
        /[0-9+-]/.test(normalized[i + 1] ?? "")
      ) {
        literal += "e";
        i += 1;
        if (/[+-]/.test(normalized[i])) {
          literal += normalized[i];
          i += 1;
        }
        while (i < normalized.length && /[0-9]/.test(normalized[i])) {
          literal += normalized[i];
          i += 1;
        }
      }
      const value = Number(literal);
      if (!Number.isFinite(value))
        throw new CalculatorError(
          i18n.t("questionTest:calculator.errors.malformedNumber"),
        );
      tokens.push({ kind: "number", value });
      continue;
    }

    if (normalized.startsWith("PI", i)) {
      tokens.push({ kind: "const", name: "PI" });
      i += 2;
      continue;
    }

    const matchedFunction = FUNCTIONS.find((name) =>
      normalized.startsWith(name, i)
    );
    if (matchedFunction) {
      tokens.push({ kind: "func", name: matchedFunction });
      i += matchedFunction.length;
      continue;
    }

    // Bare `e` that isn't part of a number literal is Euler's constant.
    if (char === "e" || char === "E") {
      tokens.push({ kind: "const", name: "E" });
      i += 1;
      continue;
    }

    if ("+-*/^()!%".includes(char)) {
      tokens.push({ kind: "op", value: char });
      i += 1;
      continue;
    }

    throw new CalculatorError(
      i18n.t("questionTest:calculator.errors.unexpectedChar", { char }),
    );
  }

  return tokens;
}

function parse(tokens: Token[], unit: AngleUnit): number {
  let cursor = 0;

  const peek = (): Token | undefined => tokens[cursor];
  const isOp = (value: string): boolean => {
    const token = peek();
    return token?.kind === "op" && token.value === value;
  };
  const eat = (value: string): boolean => {
    if (!isOp(value)) return false;
    cursor += 1;
    return true;
  };

  const parseExpression = (): number => {
    let left = parseTerm();
    for (;;) {
      if (eat("+")) left += parseTerm();
      else if (eat("-")) left -= parseTerm();
      else return left;
    }
  };

  const parseTerm = (): number => {
    let left = parseUnary();
    for (;;) {
      if (eat("*")) left *= parseUnary();
      else if (eat("/")) {
        const divisor = parseUnary();
        if (divisor === 0)
          throw new CalculatorError(
            i18n.t("questionTest:calculator.errors.divideByZero"),
          );
        left /= divisor;
      } else return left;
    }
  };

  const parseUnary = (): number => {
    if (eat("-")) return -parseUnary();
    if (eat("+")) return parseUnary();
    return parsePower();
  };

  const parsePower = (): number => {
    const base = parsePostfix();
    if (eat("^")) return base ** parseUnary();
    return base;
  };

  const parsePostfix = (): number => {
    let value = parsePrimary();
    for (;;) {
      if (eat("!")) value = factorial(value);
      else if (eat("%")) value /= 100;
      else return value;
    }
  };

  const applyFunction = (name: FunctionName, argument: number): number => {
    switch (name) {
      case "sin":
        return Math.sin(toRadians(argument, unit));
      case "cos":
        return Math.cos(toRadians(argument, unit));
      case "tan":
        return Math.tan(toRadians(argument, unit));
      case "asin":
        if (argument < -1 || argument > 1)
          throw new CalculatorError(
            i18n.t("questionTest:calculator.errors.outOfDomain"),
          );
        return fromRadians(Math.asin(argument), unit);
      case "acos":
        if (argument < -1 || argument > 1)
          throw new CalculatorError(
            i18n.t("questionTest:calculator.errors.outOfDomain"),
          );
        return fromRadians(Math.acos(argument), unit);
      case "atan":
        return fromRadians(Math.atan(argument), unit);
      case "sinh":
        return Math.sinh(argument);
      case "cosh":
        return Math.cosh(argument);
      case "tanh":
        return Math.tanh(argument);
      case "sqrt":
        if (argument < 0)
          throw new CalculatorError(
            i18n.t("questionTest:calculator.errors.outOfDomain"),
          );
        return Math.sqrt(argument);
      case "cbrt":
        return Math.cbrt(argument);
      case "log":
        if (argument <= 0)
          throw new CalculatorError(
            i18n.t("questionTest:calculator.errors.outOfDomain"),
          );
        return Math.log10(argument);
      case "ln":
        if (argument <= 0)
          throw new CalculatorError(
            i18n.t("questionTest:calculator.errors.outOfDomain"),
          );
        return Math.log(argument);
      case "exp":
        return Math.exp(argument);
      case "abs":
        return Math.abs(argument);
      default:
        throw new CalculatorError(
          i18n.t("questionTest:calculator.errors.unknownFunction"),
        );
    }
  };

  const parsePrimary = (): number => {
    const token = peek();
    if (!token)
      throw new CalculatorError(
        i18n.t("questionTest:calculator.errors.incompleteExpression"),
      );

    if (token.kind === "number") {
      cursor += 1;
      return token.value;
    }

    if (token.kind === "const") {
      cursor += 1;
      return token.name === "PI" ? Math.PI : Math.E;
    }

    if (token.kind === "func") {
      cursor += 1;
      // A trailing "sin" with no bracket is a half-typed expression, not a
      // syntax error worth shouting about — the caller shows a quiet dash.
      if (!eat("("))
        throw new CalculatorError(
          i18n.t("questionTest:calculator.errors.incompleteExpression"),
        );
      const argument = parseExpression();
      if (!eat(")"))
        throw new CalculatorError(
          i18n.t("questionTest:calculator.errors.missingParen"),
        );
      return applyFunction(token.name, argument);
    }

    if (token.kind === "op" && token.value === "(") {
      cursor += 1;
      const value = parseExpression();
      if (!eat(")"))
        throw new CalculatorError(
          i18n.t("questionTest:calculator.errors.missingParen"),
        );
      return value;
    }

    throw new CalculatorError(
      i18n.t("questionTest:calculator.errors.incompleteExpression"),
    );
  };

  const result = parseExpression();
  if (cursor !== tokens.length)
    throw new CalculatorError(
      i18n.t("questionTest:calculator.errors.incompleteExpression"),
    );
  return result;
}

/**
 * Format a result the way a handheld exam calculator does: at most 12
 * significant digits, no trailing zero noise, exponential only when the plain
 * form would be unreadable.
 */
export function formatResult(value: number): string {
  if (Number.isNaN(value))
    throw new CalculatorError(
      i18n.t("questionTest:calculator.errors.notANumber"),
    );
  if (!Number.isFinite(value))
    throw new CalculatorError(
      i18n.t("questionTest:calculator.errors.outOfRange"),
    );
  if (value === 0) return "0";

  const magnitude = Math.abs(value);
  if (magnitude >= 1e12 || magnitude < 1e-9) {
    return value.toExponential(8).replace(/\.?0+e/, "e");
  }

  const rounded = Number(value.toPrecision(12));
  return String(rounded);
}

/** Evaluate a keypad expression. Throws `CalculatorError` on bad input. */
export function evaluateExpression(
  expression: string,
  unit: AngleUnit = "DEG"
): number {
  const trimmed = expression.trim();
  if (!trimmed)
    throw new CalculatorError(i18n.t("questionTest:calculator.errors.empty"));

  const tokens = tokenize(trimmed);

  // Auto-close brackets the learner left open — a handheld calculator does the
  // same on `=`, and the alternative is an error for a perfectly clear input.
  let open = 0;
  tokens.forEach((token) => {
    if (token.kind !== "op") return;
    if (token.value === "(") open += 1;
    if (token.value === ")") open -= 1;
  });
  if (open < 0)
    throw new CalculatorError(
      i18n.t("questionTest:calculator.errors.unbalancedParen"),
    );
  for (let i = 0; i < open; i += 1) tokens.push({ kind: "op", value: ")" });

  return parse(tokens, unit);
}

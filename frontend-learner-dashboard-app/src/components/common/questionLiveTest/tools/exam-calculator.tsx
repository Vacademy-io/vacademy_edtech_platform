import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Calculator as CalculatorIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { ToolPanel } from "./tool-panel";
import {
  CalculatorError,
  evaluateExpression,
  formatResult,
  type AngleUnit,
} from "./calculator-engine";
import type { ExamCalculatorMode } from "@/types/assessment-experience";

interface ExamCalculatorProps {
  mode: ExamCalculatorMode;
  onClose: () => void;
}

type KeyTone = "digit" | "operator" | "function" | "equals" | "danger";

interface CalculatorKey {
  /** Glyph shown on the key. */
  label: string;
  /** Glyph shown instead when the 2nd-function shift is active. */
  shiftLabel?: string;
  /** Text appended to the expression. Omitted for the action keys below. */
  insert?: string;
  shiftInsert?: string;
  action?: "clear" | "backspace" | "equals" | "shift" | "angle" | "sign";
  tone?: KeyTone;
  /** Grid span, for the wide `0` key on the basic pad. */
  wide?: boolean;
  ariaLabel?: string;
}

const getBasicKeys = (t: TFunction): CalculatorKey[] => [
  { label: "C", action: "clear", tone: "danger", ariaLabel: t("calculator.keys.clear") },
  { label: "⌫", action: "backspace", tone: "operator", ariaLabel: t("calculator.keys.backspace") },
  { label: "%", insert: "%", tone: "operator", ariaLabel: t("calculator.keys.percent") },
  { label: "÷", insert: "÷", tone: "operator", ariaLabel: t("calculator.keys.divide") },

  { label: "7", insert: "7", tone: "digit" },
  { label: "8", insert: "8", tone: "digit" },
  { label: "9", insert: "9", tone: "digit" },
  { label: "×", insert: "×", tone: "operator", ariaLabel: t("calculator.keys.multiply") },

  { label: "4", insert: "4", tone: "digit" },
  { label: "5", insert: "5", tone: "digit" },
  { label: "6", insert: "6", tone: "digit" },
  { label: "−", insert: "−", tone: "operator", ariaLabel: t("calculator.keys.minus") },

  { label: "1", insert: "1", tone: "digit" },
  { label: "2", insert: "2", tone: "digit" },
  { label: "3", insert: "3", tone: "digit" },
  { label: "+", insert: "+", tone: "operator", ariaLabel: t("calculator.keys.plus") },

  { label: "0", insert: "0", tone: "digit", wide: true },
  { label: ".", insert: ".", tone: "digit", ariaLabel: t("calculator.keys.decimalPoint") },
  { label: "=", action: "equals", tone: "equals", ariaLabel: t("calculator.keys.equals") },
];

const getScientificKeys = (t: TFunction): CalculatorKey[] => [
  { label: "2nd", action: "shift", tone: "function", ariaLabel: t("calculator.keys.secondFunction") },
  { label: "DEG", action: "angle", tone: "function", ariaLabel: t("calculator.keys.toggleAngleUnit") },
  { label: "C", action: "clear", tone: "danger", ariaLabel: t("calculator.keys.clear") },
  { label: "⌫", action: "backspace", tone: "operator", ariaLabel: t("calculator.keys.backspace") },
  { label: "÷", insert: "÷", tone: "operator", ariaLabel: t("calculator.keys.divide") },

  { label: "sin", shiftLabel: "sin⁻¹", insert: "sin(", shiftInsert: "asin(", tone: "function" },
  { label: "cos", shiftLabel: "cos⁻¹", insert: "cos(", shiftInsert: "acos(", tone: "function" },
  { label: "tan", shiftLabel: "tan⁻¹", insert: "tan(", shiftInsert: "atan(", tone: "function" },
  { label: "(", insert: "(", tone: "operator", ariaLabel: t("calculator.keys.openBracket") },
  { label: ")", insert: ")", tone: "operator", ariaLabel: t("calculator.keys.closeBracket") },

  { label: "ln", shiftLabel: "eˣ", insert: "ln(", shiftInsert: "exp(", tone: "function" },
  { label: "log", shiftLabel: "10ˣ", insert: "log(", shiftInsert: "10^(", tone: "function" },
  { label: "√", shiftLabel: "∛", insert: "√(", shiftInsert: "∛(", tone: "function", ariaLabel: t("calculator.keys.squareRoot") },
  { label: "x²", shiftLabel: "x³", insert: "²", shiftInsert: "³", tone: "function", ariaLabel: t("calculator.keys.square") },
  { label: "×", insert: "×", tone: "operator", ariaLabel: t("calculator.keys.multiply") },

  { label: "7", insert: "7", tone: "digit" },
  { label: "8", insert: "8", tone: "digit" },
  { label: "9", insert: "9", tone: "digit" },
  { label: "xʸ", insert: "^", tone: "function", ariaLabel: t("calculator.keys.power") },
  { label: "−", insert: "−", tone: "operator", ariaLabel: t("calculator.keys.minus") },

  { label: "4", insert: "4", tone: "digit" },
  { label: "5", insert: "5", tone: "digit" },
  { label: "6", insert: "6", tone: "digit" },
  { label: "π", insert: "π", tone: "function", ariaLabel: t("calculator.keys.pi") },
  { label: "+", insert: "+", tone: "operator", ariaLabel: t("calculator.keys.plus") },

  { label: "1", insert: "1", tone: "digit" },
  { label: "2", insert: "2", tone: "digit" },
  { label: "3", insert: "3", tone: "digit" },
  { label: "e", insert: "e", tone: "function", ariaLabel: t("calculator.keys.eulersNumber") },
  { label: "%", shiftLabel: "|x|", insert: "%", shiftInsert: "abs(", tone: "operator", ariaLabel: t("calculator.keys.percent") },

  { label: "0", insert: "0", tone: "digit" },
  { label: ".", insert: ".", tone: "digit", ariaLabel: t("calculator.keys.decimalPoint") },
  { label: "±", action: "sign", tone: "digit", ariaLabel: t("calculator.keys.toggleSign") },
  { label: "n!", shiftLabel: "1/x", insert: "!", shiftInsert: "1÷(", tone: "function", ariaLabel: t("calculator.keys.factorial") },
  { label: "=", action: "equals", tone: "equals", ariaLabel: t("calculator.keys.equals") },
];

const TONE_CLASS: Record<KeyTone, string> = {
  digit: "bg-white text-neutral-800 border-neutral-200 hover:bg-neutral-50",
  operator: "bg-neutral-100 text-neutral-800 border-neutral-200 hover:bg-neutral-200",
  function: "bg-neutral-50 text-neutral-600 border-neutral-200 hover:bg-neutral-100",
  equals:
    "bg-primary-500 text-white border-primary-500 hover:bg-primary-400 active:bg-primary-300",
  danger: "bg-danger-50 text-danger-600 border-danger-200 hover:bg-danger-100",
};

/** Characters a physical keyboard can contribute, mapped to keypad glyphs. */
const KEYBOARD_INSERTS: Record<string, string> = {
  "*": "×",
  x: "×",
  "/": "÷",
  "-": "−",
};

export function ExamCalculator({ mode, onClose }: ExamCalculatorProps) {
  const { t } = useTranslation("questionTest");
  const [expression, setExpression] = useState("");
  const [result, setResult] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [shift, setShift] = useState(false);
  const [angleUnit, setAngleUnit] = useState<AngleUnit>("DEG");
  const containerRef = useRef<HTMLDivElement>(null);

  const isScientific = mode === "scientific";
  const keys = isScientific ? getScientificKeys(t) : getBasicKeys(t);

  // Live preview while typing. A half-finished expression is the normal state,
  // so a parse failure here is silence — never a red error.
  const preview = useMemo(() => {
    if (!expression.trim()) return null;
    try {
      return formatResult(evaluateExpression(expression, angleUnit));
    } catch {
      return null;
    }
  }, [expression, angleUnit]);

  // Own the keyboard while the calculator has focus so digits reach the pad
  // instead of the exam's arrow-key question navigation.
  useEffect(() => {
    containerRef.current?.focus({ preventScroll: true });
  }, []);

  const append = (text: string) => {
    setError(null);
    setExpression((prev) => prev + text);
  };

  const commit = () => {
    if (!expression.trim()) return;
    try {
      const value = formatResult(evaluateExpression(expression, angleUnit));
      setResult(value);
      setExpression(value);
      setError(null);
    } catch (err) {
      setError(
        err instanceof CalculatorError ? err.message : t("calculator.genericError"),
      );
    }
  };

  const handleKey = (key: CalculatorKey) => {
    switch (key.action) {
      case "clear":
        setExpression("");
        setResult("0");
        setError(null);
        return;
      case "backspace":
        setError(null);
        setExpression((prev) => prev.slice(0, -1));
        return;
      case "equals":
        commit();
        return;
      case "shift":
        setShift((prev) => !prev);
        return;
      case "angle":
        setAngleUnit((prev) => (prev === "DEG" ? "RAD" : "DEG"));
        return;
      case "sign":
        setError(null);
        setExpression((prev) =>
          prev.startsWith("−") ? prev.slice(1) : `−${prev}`,
        );
        return;
      default:
        break;
    }

    const insert = shift && key.shiftInsert ? key.shiftInsert : key.insert;
    if (!insert) return;
    append(insert);
    if (shift) setShift(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const { key } = event;

    if (key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (key === "Enter" || key === "=") {
      event.preventDefault();
      commit();
      return;
    }
    if (key === "Backspace") {
      event.preventDefault();
      setError(null);
      setExpression((prev) => prev.slice(0, -1));
      return;
    }
    if (/^[0-9.()+^%!]$/.test(key)) {
      event.preventDefault();
      append(key);
      return;
    }
    const mapped = KEYBOARD_INSERTS[key];
    if (mapped) {
      event.preventDefault();
      append(mapped);
    }
  };

  const angleKeyLabel = angleUnit === "DEG" ? "DEG" : "RAD";

  return (
    <ToolPanel
      title={t("common.tools.calculator")}
      icon={<CalculatorIcon size={15} weight="duotone" />}
      onClose={onClose}
      className={isScientific ? "w-full max-w-reg-320" : "w-full max-w-reg-250"}
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="outline-none"
      >
        <div className="mb-3 rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-end">
          <div
            className="min-h-4 truncate font-mono text-2xs text-neutral-500"
            dir="ltr"
          >
            {expression || " "}
          </div>
          <div
            className={cn(
              "truncate font-mono text-h3 font-semibold",
              error ? "text-danger-600" : "text-neutral-900",
            )}
            aria-live="polite"
          >
            {error ?? preview ?? result}
          </div>
          {isScientific && (
            <div className="mt-1 flex items-center justify-end gap-2 text-3xs font-semibold uppercase tracking-wide text-neutral-400">
              <span>{angleUnit}</span>
              {shift && <span className="text-primary-500">2nd</span>}
            </div>
          )}
        </div>

        <div
          className={cn(
            "grid gap-1.5",
            isScientific ? "grid-cols-5" : "grid-cols-4",
          )}
        >
          {keys.map((key) => {
            const isShiftKey = key.action === "shift";
            const label =
              key.action === "angle"
                ? angleKeyLabel
                : shift && key.shiftLabel
                  ? key.shiftLabel
                  : key.label;
            return (
              <button
                key={key.label}
                type="button"
                onClick={() => handleKey(key)}
                aria-label={key.ariaLabel ?? label}
                aria-pressed={isShiftKey ? shift : undefined}
                className={cn(
                  // h-10 keeps every key at a comfortable touch target while
                  // still fitting a 7-row scientific pad above the exam footer.
                  "h-10 rounded-lg border text-body font-semibold transition-colors",
                  TONE_CLASS[key.tone ?? "digit"],
                  key.wide && "col-span-2",
                  isShiftKey &&
                    shift &&
                    "border-primary-500 bg-primary-50 text-primary-500",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </ToolPanel>
  );
}
